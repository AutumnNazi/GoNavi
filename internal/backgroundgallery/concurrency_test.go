package backgroundgallery

import (
	"context"
	"crypto/tls"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCancelCleansTemporaryAndPreservesInstall(t *testing.T) {
	payload, first := syntheticPNG(t)
	second := first
	second.ID = "whale-maid-b"
	var blocked atomic.Bool
	s, _, root := galleryFixture(t, []Entry{first, second}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if blocked.Load() {
			if _, err := w.Write(payload[:8]); err != nil {
				t.Error(err)
			}
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	if _, err := s.Download(context.Background(), first.ID, first.Version, nil); err != nil {
		t.Fatal(err)
	}
	blocked.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := s.Download(ctx, second.ID, second.Version, func(p Progress) {
		if p.Downloaded > 0 {
			cancel()
		}
	})
	if ErrorCode(err) != "canceled" {
		t.Fatalf("wrong cancellation: %v", err)
	}
	assertNoTemps(t, root)
	if _, err := s.Resolve(first.ID, first.Version); err != nil {
		t.Fatalf("old install lost: %v", err)
	}
	state, err := s.Status()
	if err != nil || len(state.Installed) != 1 {
		t.Fatalf("partial installation: %+v %v", state, err)
	}
}

func TestConcurrentDownloadsBoundedAndLocalStatusResponsive(t *testing.T) {
	payload, first := syntheticPNG(t)
	second := first
	second.ID = "second"
	third := first
	third.ID = "third"
	release := make(chan struct{})
	defer close(release)
	started := make(chan struct{}, 3)
	var active, maximum atomic.Int32
	s, _, root := galleryFixture(t, []Entry{first, second, third}, func(w http.ResponseWriter, r *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		for previous := maximum.Load(); current > previous; previous = maximum.Load() {
			if maximum.CompareAndSwap(previous, current) {
				break
			}
		}
		started <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var wg sync.WaitGroup
	for _, entry := range []Entry{first, second, third} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Download(ctx, entry.ID, entry.Version, nil)
			if ErrorCode(err) != "canceled" {
				t.Errorf("wrong cancellation: %v", err)
			}
		}()
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("downloads did not start")
		}
	}
	statusDone := make(chan error, 1)
	go func() { _, err := s.Status(); statusDone <- err }()
	select {
	case err := <-statusDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("network held storage lock")
	}
	cancel()
	wg.Wait()
	if maximum.Load() != 2 {
		t.Fatalf("concurrency = %d", maximum.Load())
	}
	assertNoTemps(t, root)
}

func TestSeparateProcessesKeepBothInstallations(t *testing.T) {
	payload, first := syntheticPNG(t)
	second := first
	second.ID = "second"
	s, server, root := galleryFixture(t, []Entry{first, second}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var commands []*exec.Cmd
	for _, entry := range []Entry{first, second} {
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestGallerySubprocess$")
		command.Env = append(os.Environ(), "GONAVI_GALLERY_TEST_ROOT="+root, "GONAVI_GALLERY_TEST_URL="+server.URL+"/", "GONAVI_GALLERY_TEST_ID="+entry.ID)
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		commands = append(commands, command)
	}
	for _, command := range commands {
		if err := command.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	state, err := s.Status()
	if err != nil || len(state.Installed) != 2 {
		t.Fatalf("cross-process update lost: %+v %v", state, err)
	}
	if err := s.Remove(first.ID, first.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Resolve(second.ID, second.Version); err != nil {
		t.Fatal(err)
	}
}

func TestGallerySubprocess(t *testing.T) {
	root := os.Getenv("GONAVI_GALLERY_TEST_ROOT")
	if root == "" {
		return
	}
	// Only the local httptest TLS certificate is trusted in this subprocess fixture.
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	s, err := NewService(Options{Root: root, BaseURL: os.Getenv("GONAVI_GALLERY_TEST_URL"), Client: client})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Download(context.Background(), os.Getenv("GONAVI_GALLERY_TEST_ID"), "1", nil); err != nil {
		t.Fatal(err)
	}
}
