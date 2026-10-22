package market

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// FileStore atomically publishes immutable <root>/<sha256> files. The filesystem
// must support hard links; a failed link never falls back to an overwriting rename.
// Root and artifact files must remain owned by the service's trusted OS account.
type FileStore struct {
	root     string
	identity os.FileInfo
}

var _ ArtifactStore = (*FileStore)(nil)

// NewFileStore creates a private directory or uses an existing real directory.
// Each operation reopens a confined os.Root and checks the directory's identity.
func NewFileStore(root string) (*FileStore, error) {
	if root == "" {
		return nil, fmt.Errorf("artifact root is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve artifact root: %w", err)
	}
	if err := os.MkdirAll(absolute, 0700); err != nil {
		return nil, fmt.Errorf("create artifact root: %w", err)
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return nil, fmt.Errorf("stat artifact root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("artifact root must be a real directory")
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return nil, fmt.Errorf("canonicalize artifact root: %w", err)
	}
	store := &FileStore{root: canonical, identity: info}
	directory, err := store.openRoot()
	if err != nil {
		return nil, err
	}
	if err := directory.Close(); err != nil {
		return nil, fmt.Errorf("close artifact root: %w", err)
	}
	return store, nil
}

func (s *FileStore) openRoot() (*os.Root, error) {
	if s == nil || s.identity == nil {
		return nil, fmt.Errorf("artifact file store is not initialized")
	}
	directory, err := os.OpenRoot(s.root)
	if err != nil {
		return nil, fmt.Errorf("open artifact root: %w", err)
	}
	info, err := directory.Stat(".")
	if err != nil || !os.SameFile(s.identity, info) {
		directory.Close()
		if err != nil {
			return nil, fmt.Errorf("stat opened artifact root: %w", err)
		}
		return nil, fmt.Errorf("artifact root changed")
	}
	return directory, nil
}

// Put verifies the entire source even for an existing key, then publishes with
// an atomic no-replace hard link. Concurrent identical writers are idempotent.
func (s *FileStore) Put(ctx context.Context, digest string, source io.ReadSeeker, size int64) error {
	if err := checkArtifactPut(ctx, digest, source, size); err != nil {
		return err
	}
	directory, err := s.openRoot()
	if err != nil {
		return err
	}
	defer directory.Close()
	stage := ".upload-" + rand.Text()
	file, err := directory.OpenFile(stage, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create artifact staging file: %w", err)
	}
	defer directory.Remove(stage)
	defer file.Close()
	if err := copyArtifactSource(ctx, file, digest, source, size); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync staged artifact: %w", err)
	}
	if err := file.Chmod(0444); err != nil {
		return fmt.Errorf("seal staged artifact: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close staged artifact: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := directory.Link(stage, digest); err != nil {
		if !os.IsExist(err) {
			return fmt.Errorf("publish immutable artifact: %w", err)
		}
		existing, err := openVerifiedArtifact(ctx, directory, digest, size)
		if err != nil {
			return err
		}
		return existing.Close()
	}
	if err := directory.Remove(stage); err != nil {
		return fmt.Errorf("remove staged artifact link: %w", err)
	}
	// Windows may clear the read-only attribute while removing the staging
	// hard link. Reapply it to the published name after staging cleanup.
	if err := directory.Chmod(digest, 0444); err != nil {
		return fmt.Errorf("seal published artifact: %w", err)
	}
	return nil
}

// Open verifies stored bytes before returning a context-aware reader at offset 0.
func (s *FileStore) Open(ctx context.Context, digest string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validArtifactDigest(digest) {
		return nil, fmt.Errorf("invalid artifact sha256 digest")
	}
	directory, err := s.openRoot()
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	file, err := openVerifiedArtifact(ctx, directory, digest, 0)
	if err != nil {
		return nil, err
	}
	return &artifactReadCloser{artifactContextReader: artifactContextReader{ctx: ctx, source: file}, closer: file}, nil
}

func openVerifiedArtifact(ctx context.Context, directory *os.Root, digest string, expectedSize int64) (*os.File, error) {
	info, err := directory.Lstat(digest)
	if err != nil {
		return nil, fmt.Errorf("stat stored artifact: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > MaxArtifactBytes || (expectedSize != 0 && info.Size() != expectedSize) {
		return nil, fmt.Errorf("stored artifact is not a regular file of the expected size")
	}
	file, err := directory.Open(digest)
	if err != nil {
		return nil, fmt.Errorf("open stored artifact: %w", err)
	}
	if err := verifyArtifactFile(ctx, file, info, digest); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func verifyArtifactFile(ctx context.Context, file *os.File, original os.FileInfo, digest string) error {
	opened, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat opened stored artifact: %w", err)
	}
	if !os.SameFile(original, opened) || !opened.Mode().IsRegular() {
		return fmt.Errorf("stored artifact changed while opening")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(artifactContextReader{ctx: ctx, source: file}, MaxArtifactBytes+1))
	if err != nil {
		return fmt.Errorf("verify stored artifact: %w", err)
	}
	if n != original.Size() || hex.EncodeToString(hash.Sum(nil)) != digest {
		return fmt.Errorf("stored artifact size or sha256 mismatch")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind stored artifact: %w", err)
	}
	return ctx.Err()
}
