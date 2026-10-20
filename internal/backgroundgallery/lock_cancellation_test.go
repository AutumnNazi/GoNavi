package backgroundgallery

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/appdata"
)

func TestGalleryCancellationLockHolder(t *testing.T) {
	path := os.Getenv("GONAVI_GALLERY_CANCELLATION_LOCK")
	if path == "" {
		return
	}
	lock, err := appdata.AcquireFileLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := lock.Close(); err != nil {
			t.Error(err)
		}
	}()
	if _, err := fmt.Fprintln(os.Stdout, "locked"); err != nil {
		t.Fatal(err)
	}
	// Closing the parent's pipe releases the child, including failed assertions.
	if _, err := io.Copy(io.Discard, os.Stdin); err != nil {
		t.Fatal(err)
	}
}

func holdGalleryProcessLock(t *testing.T, s *Service) func() {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestGalleryCancellationLockHolder$")
	cmd.Env = append(os.Environ(), "GONAVI_GALLERY_CANCELLATION_LOCK="+filepath.Join(s.root, ".storage.lock"))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			if err := stdin.Close(); err != nil {
				t.Error(err)
			}
			if err := cmd.Wait(); err != nil {
				t.Errorf("lock holder: %v: %s", err, stderr.String())
			}
		})
	}
	t.Cleanup(release)
	if ready, err := bufio.NewReader(stdout).ReadString('\n'); err != nil || ready != "locked\n" {
		t.Fatalf("lock holder readiness = %q, error = %v", ready, err)
	}
	return release
}

func awaitGalleryCancellation(t *testing.T, done <-chan error, unblock func()) {
	t.Helper()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		// Unblock and join even on the pre-fix path, rather than leak a waiter.
		unblock()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("operation did not finish after releasing its lock")
		}
		t.Fatal("cancellation waited for storage lock release")
	}
}

func TestRefreshCancellationWithCrossProcessLock(t *testing.T) {
	for _, cached := range []bool{true, false} {
		t.Run(fmt.Sprintf("cached=%t", cached), func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			s, root := storageFixture(t, []Entry{entry}, payload)
			catalogPath := filepath.Join(s.root, "catalog.json")
			before, err := os.ReadFile(catalogPath)
			if err != nil {
				t.Fatal(err)
			}
			if !cached {
				if err := os.Remove(catalogPath); err != nil {
					t.Fatal(err)
				}
			}
			next, err := json.Marshal(Catalog{SchemaVersion: 1, Version: "2", Entries: []Entry{entry}})
			if err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			s.client.Transport = storageTransport(func(*http.Request) (*http.Response, error) {
				requests.Add(1)
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(bytes.NewReader(next)), ContentLength: int64(len(next))}, nil
			})
			release := holdGalleryProcessLock(t, s)
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()
			// One result lets the worker exit even if the timeout assertion fires.
			done := make(chan error, 1)
			go func() { _, err := s.Refresh(ctx); done <- err }()
			awaitGalleryCancellation(t, done, release)
			if requests.Load() != 1 {
				t.Fatal("refresh did not reach the contended persistence phase")
			}
			after, err := os.ReadFile(catalogPath)
			if cached && (err != nil || !bytes.Equal(before, after)) {
				t.Fatalf("canceled refresh replaced cached catalog: %v", err)
			}
			if !cached && !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("canceled refresh published a catalog: %v", err)
			}
			assertNoTemps(t, root)
			release()
			state, err := s.Refresh(context.Background())
			if err != nil || state.Catalog == nil || state.Catalog.Version != "2" || state.Stale {
				t.Fatalf("fresh refresh after unlock: %+v, %v", state, err)
			}
		})
	}
}

func TestNetworkCancellationWhileLocalMutexHeld(t *testing.T) {
	for _, phase := range []string{"download-lookup", "download-catalog", "download-commit", "refresh-commit", "refresh-fallback", "refresh-canceled-fallback"} {
		t.Run(phase, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			s, root := storageFixture(t, []Entry{entry}, payload)
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()
			var held atomic.Bool
			hold := func() { s.mu.Lock(); held.Store(true) }
			release := func() {
				if held.Swap(false) {
					s.mu.Unlock()
				}
			}
			t.Cleanup(release)
			if phase != "download-commit" {
				hold()
			}
			transport := s.client.Transport
			var requests atomic.Int32
			s.client.Transport = storageTransport(func(r *http.Request) (*http.Response, error) {
				requests.Add(1)
				if phase == "refresh-canceled-fallback" {
					cancel()
					return nil, ctx.Err()
				}
				if phase == "refresh-fallback" {
					return nil, errors.New("offline fixture")
				}
				return transport.RoundTrip(r)
			})
			// One result lets the worker exit even if the timeout assertion fires.
			done := make(chan error, 1)
			go func() {
				if phase == "download-catalog" {
					// Exercise the second lookup boundary independently of Resolve.
					_, err := s.catalogEntry(ctx, entry.ID, entry.Version)
					done <- err
					return
				}
				if phase == "download-lookup" || phase == "download-commit" {
					_, err := s.Download(ctx, entry.ID, entry.Version, func(p Progress) {
						if phase == "download-commit" && p.Phase == "installing" {
							hold()
						}
					})
					done <- err
					return
				}
				_, err := s.Refresh(ctx)
				done <- err
			}()
			awaitGalleryCancellation(t, done, release)
			wantRequests := int32(1)
			if phase == "download-lookup" || phase == "download-catalog" {
				wantRequests = 0
			}
			if requests.Load() != wantRequests || !held.Load() {
				t.Fatalf("operation missed local contention: requests=%d, held=%t", requests.Load(), held.Load())
			}
			assertNoTemps(t, root)
			// Canceling the local wait must release the already-acquired file lock.
			lockCtx, lockCancel := context.WithTimeout(context.Background(), time.Second)
			defer lockCancel()
			lock, err := appdata.AcquireFileLockContext(lockCtx, filepath.Join(s.root, ".storage.lock"))
			if err != nil {
				t.Fatalf("canceled local waiter retained process lock: %v", err)
			}
			if err := lock.Close(); err != nil {
				t.Fatal(err)
			}
			release()
			if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
				t.Fatalf("canceled operation installed: %v", err)
			}
			s.client.Transport = transport
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
				t.Fatalf("fresh download after unlock: %v", err)
			}
			if _, err := s.Refresh(context.Background()); err != nil {
				t.Fatalf("fresh refresh after unlock: %v", err)
			}
		})
	}
}

func TestOfflineReadsWhileMutationWaitsForProcessLock(t *testing.T) {
	for _, operation := range []string{"download", "refresh"} {
		t.Run(operation, func(t *testing.T) {
			payload, previous := syntheticPNG(t)
			next := previous
			next.ID = "next"
			s, _ := storageFixture(t, []Entry{previous, next}, payload)
			if _, err := s.Download(context.Background(), previous.ID, previous.Version, nil); err != nil {
				t.Fatal(err)
			}
			release := holdGalleryProcessLock(t, s)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started := make(chan struct{})
			var startOnce sync.Once
			transport := s.client.Transport
			s.client.Transport = storageTransport(func(r *http.Request) (*http.Response, error) {
				response, err := transport.RoundTrip(r)
				startOnce.Do(func() { close(started) })
				return response, err
			})
			// One result lets the writer exit while the test checks offline readers.
			written := make(chan error, 1)
			go func() {
				if operation == "download" {
					_, err := s.Download(ctx, next.ID, next.Version, nil)
					written <- err
					return
				}
				_, err := s.Refresh(ctx)
				written <- err
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				cancel()
				release()
				<-written
				t.Fatal("mutation did not start")
			}
			// Let the small in-memory response reach the contended transaction.
			timer := time.NewTimer(50 * time.Millisecond)
			defer timer.Stop()
			<-timer.C
			read := make(chan struct{})
			go func() {
				defer close(read)
				assertOfflineStorageReads(t, s, previous, payload)
			}()
			select {
			case <-read:
			case <-time.After(time.Second):
				cancel()
				release()
				<-written
				<-read
				t.Fatal("offline readers waited behind external lock holder")
			}
			cancel()
			awaitGalleryCancellation(t, written, release)
		})
	}
}

func TestDownloadCancellationWithCrossProcessLock(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, root := storageFixture(t, []Entry{entry}, payload)
	release := holdGalleryProcessLock(t, s)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	// One result lets the worker exit even if the timeout assertion fires.
	done := make(chan error, 1)
	installing := make(chan struct{})
	go func() {
		_, err := s.Download(ctx, entry.ID, entry.Version, func(p Progress) {
			if p.Phase == "installing" {
				close(installing)
			}
		})
		done <- err
	}()
	awaitGalleryCancellation(t, done, release)
	select {
	case <-installing:
	default:
		t.Fatal("download never reached the contended installation")
	}
	assertNoTemps(t, root)
	if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
		t.Fatalf("canceled download installed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.root, filepath.FromSlash(entry.Image.Path))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled download published bytes: %v", err)
	}
	release()
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatalf("fresh download after unlock: %v", err)
	}
}
