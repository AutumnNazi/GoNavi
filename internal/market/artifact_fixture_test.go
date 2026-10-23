package market

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

const artifactTestManifest = `{"schemaVersion":1,"apiVersion":1,"id":"example.fixture","name":"Fixture","version":"1.2.3","description":"An inert fixture","author":"Test","permissions":[],"minHostVersion":"0.9.0","backend":{"platforms":{"windows/amd64":{"executable":"bin/plugin","runtime":"native"},"linux/amd64":{"executable":"bin/plugin","args":["--fixture"]}}}}`

type artifactTestEntry struct {
	name     string
	body     []byte
	mode     fs.FileMode
	tarType  byte
	linkname string
	extra    []byte
	flags    uint16
}

func artifactTestEntries(manifest string) []artifactTestEntry {
	return []artifactTestEntry{
		{name: artifactManifestName, body: []byte(manifest)},
		{name: "bin/plugin", body: []byte("fixture bytes; never execute"), mode: 0755},
	}
}

func artifactTestZIP(t *testing.T, entries []artifactTestEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store, Extra: entry.extra, Flags: entry.flags}
		mode := entry.mode
		if mode == 0 {
			mode = 0644
		}
		header.SetMode(mode)
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(entry.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func artifactTestTar(t *testing.T, entries []artifactTestEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for _, entry := range entries {
		kind := entry.tarType
		if kind == 0 {
			kind = tar.TypeReg
		}
		header := &tar.Header{Name: entry.name, Mode: 0644, Size: int64(len(entry.body)), Typeflag: kind, Linkname: entry.linkname}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func artifactTestGzip(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func artifactTestArchive(t *testing.T, format string, entries []artifactTestEntry) []byte {
	t.Helper()
	if format == ".zip" {
		return artifactTestZIP(t, entries)
	}
	return artifactTestGzip(t, artifactTestTar(t, entries))
}

func artifactTestWrite(t *testing.T, format string, contents []byte) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "fixture"+format)
	if err := os.WriteFile(filename, contents, 0600); err != nil {
		t.Fatal(err)
	}
	return filename
}

func artifactTestDigest(contents []byte) string {
	digest := sha256.Sum256(contents)
	return hex.EncodeToString(digest[:])
}

func artifactTestChange(t *testing.T, modify func(map[string]any)) string {
	t.Helper()
	var manifest map[string]any
	if err := json.Unmarshal([]byte(artifactTestManifest), &manifest); err != nil {
		t.Fatal(err)
	}
	modify(manifest)
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
