package market

import (
	"archive/tar"
	"bytes"
	"context"
	"testing"
)

func TestArtifactTGZRejectsLinksAndSpecialFiles(t *testing.T) {
	for _, kind := range []byte{tar.TypeLink, tar.TypeSymlink, tar.TypeChar, tar.TypeBlock, tar.TypeFifo} {
		t.Run(string(kind), func(t *testing.T) {
			entries := append(artifactTestEntries(artifactTestManifest), artifactTestEntry{name: "special", tarType: kind, linkname: "bin/plugin"})
			filename := artifactTestWrite(t, ".tgz", artifactTestArchive(t, ".tgz", entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted link or special file")
			}
		})
	}
}

func TestArtifactTGZRejectsCorruptionAndTrailingData(t *testing.T) {
	tarBytes := artifactTestTar(t, artifactTestEntries(artifactTestManifest))
	gzipBytes := artifactTestGzip(t, tarBytes)
	badCRC := bytes.Clone(gzipBytes)
	badCRC[len(badCRC)-8] ^= 1
	badTar := bytes.Clone(tarBytes)
	badTar[0] ^= 1
	cases := map[string][]byte{
		"checksum":           badCRC,
		"truncated gzip":     gzipBytes[:len(gzipBytes)-1],
		"truncated tar":      artifactTestGzip(t, tarBytes[:len(tarBytes)-1024]),
		"tar checksum":       artifactTestGzip(t, badTar),
		"trailing gzip data": append(bytes.Clone(gzipBytes), 0),
		"concatenated gzip":  append(bytes.Clone(gzipBytes), gzipBytes...),
		"trailing tar data":  artifactTestGzip(t, append(bytes.Clone(tarBytes), 1)),
	}
	for name, contents := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, ".tgz", contents)); err == nil {
				t.Fatal("accepted corrupt tgz")
			}
		})
	}
}

func TestArtifactTGZRejectsHugeDeclaredFileBeforeReading(t *testing.T) {
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	if err := writer.WriteHeader(&tar.Header{Name: "huge", Mode: 0644, Size: maxArtifactExpandedBytes + 1}); err != nil {
		t.Fatal(err)
	}
	// Deliberately omit payload: the declaration alone must fail the bound.
	filename := artifactTestWrite(t, ".tgz", artifactTestGzip(t, buffer.Bytes()))
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("accepted oversized declaration")
	}
}

func TestArtifactTGZDirectoryAndPAXMetadata(t *testing.T) {
	entries := append(artifactTestEntries(artifactTestManifest), artifactTestEntry{name: "bin/", tarType: tar.TypeDir}, artifactTestEntry{name: "assets/" + string(bytes.Repeat([]byte("long"), 40)), body: []byte("asset")})
	if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, ".tgz", artifactTestArchive(t, ".tgz", entries))); err != nil {
		t.Fatal(err)
	}
}
