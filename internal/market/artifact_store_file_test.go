package market

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestFileStoreImmutableRoundTripAndConcurrentWriters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "objects")
	store, err := NewFileStore(root)
	if err != nil {
		t.Fatal(err)
	}
	contents := bytes.Repeat([]byte("immutable bytes"), 8192)
	digest := artifactTestDigest(contents)
	errorsByWriter := make(chan error, 8)
	var writers sync.WaitGroup
	for range 8 {
		writers.Add(1)
		go func() {
			defer writers.Done()
			errorsByWriter <- store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents)))
		}()
	}
	writers.Wait()
	close(errorsByWriter)
	for err := range errorsByWriter {
		if err != nil {
			t.Fatal(err)
		}
	}
	reader, err := store.Open(context.Background(), digest)
	if err != nil {
		t.Fatal(err)
	}
	actual, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(actual, contents) {
		t.Fatalf("round trip: %v, %v, bytes=%d", readErr, closeErr, len(actual))
	}
	info, err := os.Stat(filepath.Join(root, digest))
	if err != nil || info.Mode().Perm()&0222 != 0 {
		t.Fatalf("artifact is not read-only: %v, %v", info, err)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 || entries[0].Name() != digest {
		t.Fatalf("staging files remain: %v, %v", entries, err)
	}
}

func TestFileStoreRejectsSourceMismatchWithoutPublication(t *testing.T) {
	contents := []byte("expected")
	cases := []struct {
		name   string
		digest string
		body   []byte
		size   int64
	}{
		{"hash", strings.Repeat("0", 64), contents, 8},
		{"short", artifactTestDigest(contents), contents[:7], 8},
		{"long", artifactTestDigest(contents), append(bytes.Clone(contents), 0), 8},
		{"size zero", artifactTestDigest(contents), contents, 0},
		{"oversized", artifactTestDigest(contents), contents, MaxArtifactBytes + 1},
		{"unsafe digest", "../" + strings.Repeat("a", 61), contents, 8},
		{"uppercase digest", strings.ToUpper(artifactTestDigest(contents)), contents, 8},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			store, err := NewFileStore(root)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Put(context.Background(), test.digest, bytes.NewReader(test.body), test.size); err == nil {
				t.Fatal("accepted invalid source")
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("failed write left files: %v, %v", entries, err)
			}
		})
	}
}

func TestFileStoreRewindsAndVerifiesExistingBytes(t *testing.T) {
	root := t.TempDir()
	store, err := NewFileStore(root)
	if err != nil {
		t.Fatal(err)
	}
	contents := []byte("expected")
	digest := artifactTestDigest(contents)
	source := bytes.NewReader(contents)
	if _, err := source.Seek(3, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), digest, source, int64(len(contents))); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(root, digest)
	if err := os.Chmod(filename, 0600); err != nil {
		t.Fatal(err)
	}
	corrupt := []byte("tampered")
	if err := os.WriteFile(filename, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(context.Background(), digest); err == nil {
		t.Fatal("opened corrupt content")
	}
	if err := store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents))); err == nil {
		t.Fatal("accepted corrupt existing key")
	}
	actual, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(actual, corrupt) {
		t.Fatalf("existing key was overwritten: %q, %v", actual, err)
	}
}

func TestFileStoreCancellationAndMissingObjects(t *testing.T) {
	store, err := NewFileStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("expected")
	digest := artifactTestDigest(body)
	if _, err := store.Open(context.Background(), digest); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing object = %v", err)
	}
	if _, err := store.Open(context.Background(), "../escape"); err == nil {
		t.Fatal("accepted invalid digest")
	}
	ctx, cancel := context.WithCancel(context.Background())
	source := &artifactCancelSource{Reader: bytes.NewReader(body), cancel: cancel}
	if err := store.Put(ctx, digest, source, int64(len(body))); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled write = %v", err)
	}
	if _, err := store.Open(ctx, digest); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled open = %v", err)
	}
	if err := store.Put(context.Background(), digest, bytes.NewReader(body), int64(len(body))); err != nil {
		t.Fatal(err)
	}
	readContext, stopRead := context.WithCancel(context.Background())
	reader, err := store.Open(readContext, digest)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	stopRead()
	if _, err := reader.Read(make([]byte, 1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled read = %v", err)
	}
}

type artifactCancelSource struct {
	*bytes.Reader
	cancel context.CancelFunc
}

func (s *artifactCancelSource) Read(buffer []byte) (int, error) {
	n, err := s.Reader.Read(buffer)
	s.cancel()
	return n, err
}

func TestFileStoreRejectsSymlinksAndChangedRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "objects")
	store, err := NewFileStore(root)
	if err != nil {
		t.Fatal(err)
	}
	contents := []byte("expected")
	digest := artifactTestDigest(contents)
	outside := artifactTestWrite(t, ".data", contents)
	if err := os.Symlink(outside, filepath.Join(root, digest)); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := store.Open(context.Background(), digest); err == nil {
		t.Fatal("opened symlink")
	}
	if err := store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents))); err == nil {
		t.Fatal("reused symlink")
	}
	moved := root + "-original"
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents))); err == nil {
		t.Fatal("wrote to replaced root")
	}
}

func TestNewFileStoreRejectsInvalidRoot(t *testing.T) {
	for _, root := range []string{"", artifactTestWrite(t, ".file", []byte("not a directory"))} {
		if _, err := NewFileStore(root); err == nil {
			t.Fatalf("accepted root %q", root)
		}
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := NewFileStore(link); err == nil {
		t.Fatal("accepted root symlink")
	}
}
