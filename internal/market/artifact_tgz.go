package market

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"strings"
)

func (index *artifactIndex) readTGZ(ctx context.Context, data []byte) error {
	compressed := bytes.NewReader(data)
	gz, err := gzip.NewReader(artifactContextReader{ctx, compressed})
	if err != nil {
		return fmt.Errorf("open gzip stream: %w", err)
	}
	defer gz.Close()
	// The ByteReader below prevents gzip from reading past a single member.
	gz.Multistream(false)
	// Account for bounded tar headers and metadata in addition to payload bytes.
	raw := &io.LimitedReader{R: artifactContextReader{ctx, gz}, N: maxArtifactExpandedBytes + maxArtifactFiles*4096 + 1}
	tr := tar.NewReader(raw)
	for {
		before := raw.N
		header, err := tr.Next()
		if err == io.EOF {
			if before-raw.N < 1024 {
				return fmt.Errorf("tar end marker is missing")
			}
			break
		}
		if err != nil {
			return fmt.Errorf("read tar header: %w", err)
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA && header.Typeflag != tar.TypeDir {
			return fmt.Errorf("tar entry is a link or special file")
		}
		if header.Linkname != "" {
			return fmt.Errorf("tar link target is unsupported")
		}
		for key := range header.PAXRecords {
			if strings.HasPrefix(key, "GNU.sparse") || strings.HasPrefix(key, "SCHILY.") {
				return fmt.Errorf("sparse or special tar metadata is unsupported")
			}
		}
		if err := index.add(header.Name, header.Typeflag == tar.TypeDir, header.Size); err != nil {
			return err
		}
		if err := index.readEntry(ctx, header.Name, header.Size, tr); err != nil {
			return err
		}
	}
	// Read through gzip's checksum, reject extra tar contents, and enforce the
	// raw expansion budget even when metadata was consumed inside tar.Next.
	buffer := make([]byte, 32<<10)
	for {
		n, err := raw.Read(buffer)
		if raw.N == 0 {
			return fmt.Errorf("tar stream exceeds expansion budget")
		}
		if !allArtifactZero(buffer[:n]) {
			return fmt.Errorf("data after tar end marker")
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read gzip trailer: %w", err)
		}
	}
	if compressed.Len() != 0 {
		return fmt.Errorf("trailing or concatenated gzip stream")
	}
	return nil
}

func allArtifactZero(data []byte) bool {
	for _, b := range data {
		if b != 0 {
			return false
		}
	}
	return true
}

// ReadByte makes gzip preserve trailing bytes while still observing cancellation.
func (r artifactContextReader) ReadByte() (byte, error) {
	var b [1]byte
	_, err := io.ReadFull(r, b[:])
	return b[0], err
}
