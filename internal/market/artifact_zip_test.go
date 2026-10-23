package market

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"io/fs"
	"testing"
)

func TestArtifactZIPRejectsLinksAndSpecialFiles(t *testing.T) {
	for _, mode := range []fs.FileMode{fs.ModeSymlink | 0777, fs.ModeNamedPipe | 0600, fs.ModeDevice | 0600, fs.ModeSocket | 0600} {
		t.Run(mode.String(), func(t *testing.T) {
			entries := append(artifactTestEntries(artifactTestManifest), artifactTestEntry{name: "special", mode: mode})
			filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted link or special file")
			}
		})
	}
	for _, id := range []uint16{0x0001, 0x000d, 0x756e} {
		t.Run("link or zip64 metadata", func(t *testing.T) {
			extra := make([]byte, 4)
			binary.LittleEndian.PutUint16(extra, id)
			entries := artifactTestEntries(artifactTestManifest)
			entries[1].extra = extra
			filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted unsafe metadata")
			}
		})
	}
}

func TestArtifactZIPRejectsCorruptionAndHiddenData(t *testing.T) {
	original := artifactTestZIP(t, artifactTestEntries(artifactTestManifest))
	central := bytes.Index(original, []byte("PK\x01\x02"))
	end := len(original) - 22
	cases := map[string]func([]byte) []byte{
		"truncated": func(data []byte) []byte { return data[:len(data)-1] },
		"trailing":  func(data []byte) []byte { return append(data, 0) },
		"prefix":    func(data []byte) []byte { return append([]byte("MZ"), data...) },
		"crc": func(data []byte) []byte {
			offset := bytes.Index(data, []byte("fixture bytes; never execute"))
			data[offset] ^= 1
			return data
		},
		"local filename mismatch": func(data []byte) []byte { data[30] ^= 1; return data },
		"local flags mismatch":    func(data []byte) []byte { data[6] ^= 1; return data },
		"local size mismatch":     func(data []byte) []byte { data[18] = 1; return data },
		"data descriptor": func(data []byte) []byte {
			offset := bytes.Index(data, []byte("PK\x07\x08"))
			data[offset+4] ^= 1
			return data
		},
		"directory count": func(data []byte) []byte { data[end+10]++; return data },
		"expanded size": func(data []byte) []byte {
			binary.LittleEndian.PutUint32(data[central+24:], maxArtifactExpandedBytes+1)
			return data
		},
		"overlap": func(data []byte) []byte {
			second := central + bytes.Index(data[central+4:], []byte("PK\x01\x02")) + 4
			binary.LittleEndian.PutUint32(data[second+42:], 0)
			return data
		},
	}
	for name, corrupt := range cases {
		t.Run(name, func(t *testing.T) {
			contents := corrupt(bytes.Clone(original))
			filename := artifactTestWrite(t, ".zip", contents)
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted corrupt archive")
			}
		})
	}
}

func TestArtifactZIPDeflateAndDirectoryEntries(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range append(artifactTestEntries(artifactTestManifest), artifactTestEntry{name: "bin/", mode: fs.ModeDir | 0755}) {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		header.SetMode(entry.mode)
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
	if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, ".zip", buffer.Bytes())); err != nil {
		t.Fatal(err)
	}
}

func TestArtifactZIPRejectsEncryption(t *testing.T) {
	entries := artifactTestEntries(artifactTestManifest)
	entries[1].flags = 1
	if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, ".zip", artifactTestZIP(t, entries))); err == nil {
		t.Fatal("accepted encrypted entry")
	}
}
