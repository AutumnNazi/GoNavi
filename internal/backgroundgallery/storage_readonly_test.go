package backgroundgallery

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/appdata"
)

type storageTransport func(*http.Request) (*http.Response, error)

func (f storageTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// storageFixture exercises the public API without opening network sockets.
func storageFixture(t *testing.T, entries []Entry, payload []byte) (*Service, string) {
	t.Helper()
	catalog, err := json.Marshal(Catalog{SchemaVersion: 1, Version: "1", Entries: entries})
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: storageTransport(func(r *http.Request) (*http.Response, error) {
		body, mime := payload, "image/png"
		if filepath.Base(r.URL.Path) == "catalog.json" {
			body, mime = catalog, "application/json"
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {mime}}, Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}, nil
	})}
	root := t.TempDir()
	s, err := NewService(Options{Root: root, Client: client})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s, root
}

func assertOfflineStorageReads(t *testing.T, s *Service, entry Entry, payload []byte) {
	t.Helper()
	state, err := s.Status()
	if err != nil || state.Catalog == nil || len(state.Installed) != 1 || state.WarningCode != "" {
		t.Errorf("offline status lost readable cache: %+v, %v", state, err)
	}
	installed, err := s.Resolve(entry.ID, "")
	if err != nil || installed.Entry.License.Text != entry.License.Text {
		t.Errorf("offline resolve lost installed image or license: %+v, %v", installed, err)
	}
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Errorf("cached download needs writable storage: %v", err)
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		recorder := httptest.NewRecorder()
		s.ServeHTTP(recorder, httptest.NewRequest(method, installation(entry).URL, nil))
		if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != entry.Image.MIMEType {
			t.Errorf("offline %s = %d, headers %v", method, recorder.Code, recorder.Header())
		}
		if method == http.MethodGet && !bytes.Equal(recorder.Body.Bytes(), payload) {
			t.Error("offline GET did not return verified bytes")
		}
	}
}

func TestCachedReadsDoNotRequireStorageLock(t *testing.T) {
	for _, blocker := range []bool{false, true} {
		name := "absent-lock"
		if blocker {
			name = "lock-directory-root-proof"
		}
		t.Run(name, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			s, root := storageFixture(t, []Entry{entry}, payload)
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
				t.Fatal(err)
			}
			lockPath := filepath.Join(s.root, ".storage.lock")
			if err := os.Remove(lockPath); err != nil {
				t.Fatal(err)
			}
			if blocker {
				if err := os.Mkdir(lockPath, 0700); err != nil {
					t.Fatal(err)
				}
			}
			offline, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
			if err != nil {
				t.Fatal(err)
			}
			assertOfflineStorageReads(t, offline, entry, payload)
			if !blocker {
				if _, err := os.Lstat(lockPath); !os.IsNotExist(err) {
					t.Errorf("cached reads created a storage lock: %v", err)
				}
			}
		})
	}
}

func TestCachedReadsOnReadOnlyStorage(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, root := storageFixture(t, []Entry{entry}, payload)
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(s.root, ".storage.lock")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{s.root, filepath.Join(s.root, "assets"), filepath.Join(s.root, "catalog.json"), filepath.Join(s.root, "installed.json"), filepath.Join(s.root, filepath.FromSlash(entry.Image.Path))} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := os.Chmod(path, info.Mode().Perm()); err != nil {
				t.Error(err)
			}
		})
		mode := os.FileMode(0400)
		if info.IsDir() {
			mode = 0500
		}
		if err := os.Chmod(path, mode); err != nil {
			t.Skipf("cannot enforce readonly permissions: %v", err)
		}
	}
	probe, err := os.CreateTemp(s.root, ".readonly-probe-*")
	if err == nil {
		if err := probe.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(probe.Name()); err != nil {
			t.Fatal(err)
		}
		t.Skip("readonly permissions not enforced (for example root); root-proof lock-directory regression remains active")
	}
	if !os.IsPermission(err) {
		t.Fatalf("unexpected permission probe failure: %v", err)
	}
	offline, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	assertOfflineStorageReads(t, offline, entry, payload)
}

func TestCachedSnapshotDoesNotWaitForAnotherWriterCommit(t *testing.T) {
	payload, previous := syntheticPNG(t)
	next := previous
	next.ID = "next"
	writer, root := storageFixture(t, []Entry{previous, next}, payload)
	if _, err := writer.Download(context.Background(), previous.ID, previous.Version, nil); err != nil {
		t.Fatal(err)
	}
	reader, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	writer.replaceFile = func(source, target string) error {
		if filepath.Base(target) == "installed.json" {
			close(entered)
			<-release
		}
		return appdata.AtomicReplaceFile(source, target)
	}
	// Buffered result permits writer shutdown even after a timeout assertion.
	written := make(chan error, 1)
	go func() {
		_, err := writer.Download(context.Background(), next.ID, next.Version, nil)
		written <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		if err := <-written; err != nil {
			t.Error(err)
		}
		t.Fatal("writer did not reach metadata commit")
	}
	read := make(chan struct{})
	go func() {
		defer close(read)
		assertOfflineStorageReads(t, reader, previous, payload)
	}()
	select {
	case <-read:
	case <-time.After(3 * time.Second):
		t.Error("cached snapshot waited for another service's exclusive write lock")
	}
	close(release)
	if err := <-written; err != nil {
		t.Fatal(err)
	}
	<-read
	state, err := reader.Status()
	if err != nil || len(state.Installed) != 2 {
		t.Fatalf("reader did not observe completed atomic update: %+v, %v", state, err)
	}
}
