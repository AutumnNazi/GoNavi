package market

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
)

// ArtifactStore stores immutable bytes addressed by their lowercase SHA-256.
// Put rewinds source and verifies both its exact length and hash before publishing.
type ArtifactStore interface {
	Put(ctx context.Context, digest string, source io.ReadSeeker, size int64) error
	Open(ctx context.Context, digest string) (io.ReadCloser, error)
}

func validArtifactDigest(digest string) bool {
	if len(digest) != sha256.Size*2 {
		return false
	}
	for _, character := range digest {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func checkArtifactPut(ctx context.Context, digest string, source io.ReadSeeker, size int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validArtifactDigest(digest) || source == nil || size <= 0 || size > MaxArtifactBytes {
		return fmt.Errorf("artifact requires a sha256 digest, source, and size of 1 to %d bytes", MaxArtifactBytes)
	}
	position, err := source.Seek(0, io.SeekStart)
	if err != nil {
		return fmt.Errorf("rewind artifact source: %w", err)
	}
	if position != 0 {
		return fmt.Errorf("artifact source failed to rewind")
	}
	return nil
}

func copyArtifactSource(ctx context.Context, destination io.Writer, digest string, source io.Reader, size int64) error {
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(destination, hash), io.LimitReader(artifactContextReader{ctx, source}, size+1))
	if err != nil {
		return fmt.Errorf("copy artifact source: %w", err)
	}
	if n != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return fmt.Errorf("artifact source size or sha256 mismatch")
	}
	return ctx.Err()
}

type artifactReadCloser struct {
	artifactContextReader
	closer io.Closer
}

func (r *artifactReadCloser) Close() error {
	return r.closer.Close()
}
