package plugin

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func skillArchive(t *testing.T, format string, entries map[string][]byte) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "skills."+format)
	output, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names))) // Exercise archives whose manifest arrives after the document.
	if format == "zip" {
		writer := zip.NewWriter(output)
		for _, name := range names {
			file, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = file.Write(entries[name]); err != nil {
				t.Fatal(err)
			}
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
	} else {
		gz := gzip.NewWriter(output)
		writer := tar.NewWriter(gz)
		for _, name := range names {
			if err = writer.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: int64(len(entries[name]))}); err != nil {
				t.Fatal(err)
			}
			if _, err = writer.Write(entries[name]); err != nil {
				t.Fatal(err)
			}
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		if err = gz.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if err = output.Close(); err != nil {
		t.Fatal(err)
	}
	return filename
}

func TestSkillPackagesValidateDeclaredBytesWithoutExecution(t *testing.T) {
	manifest := skillManifest()
	body := []byte("---\nrequiredTools: [shell]\n---\n# Opaque skill text\nDo not execute anything.\n")
	directory := skillPackage(t, manifest, body)
	baseline, err := InspectPackage(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"zip", "tgz"} {
		t.Run(format, func(t *testing.T) {
			archive := skillArchive(t, format, map[string][]byte{manifestName: raw, "asset.txt": []byte("hello"), manifest.Contributes.Skills[0].Entry: body})
			inspection, err := InspectPackage(context.Background(), archive)
			if err != nil {
				t.Fatal(err)
			}
			if inspection.Digest != baseline.Digest {
				t.Fatal("skill package digest changed with transport")
			}
			serialized, err := json.Marshal(inspection)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(serialized), "requiredTools") {
				t.Fatal("inspection leaked body or interpreted frontmatter")
			}
			if inspection.Manifest.Backend != nil || len(inspection.Manifest.Permissions) != 1 || inspection.Manifest.Permissions[0] != "ai.skills" {
				t.Fatal("document granted implicit authority")
			}
		})
	}
}

func TestSkillContentLimitsAcrossPackageFormats(t *testing.T) {
	cases := []struct {
		name  string
		body  []byte
		valid bool
	}{
		{"empty", nil, false}, {"nul", []byte("a\x00b"), false}, {"invalid utf8", []byte{0xff, 0xfe}, false},
		{"oversized", []byte(strings.Repeat("x", maxSkillBytes+1)), false},
		{"exact bound", []byte(strings.Repeat("x", maxSkillBytes)), true}, {"whitespace", []byte(" \n\t"), true},
		{"multibyte exact", []byte(strings.Repeat("文", 21845)), true},
		{"multibyte over", []byte(strings.Repeat("文", 21846)), false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := skillManifest()
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			for _, format := range []string{"directory", "zip", "tgz"} {
				source := ""
				if format == "directory" {
					source = skillPackage(t, manifest, test.body)
				} else {
					source = skillArchive(t, format, map[string][]byte{manifestName: raw, manifest.Contributes.Skills[0].Entry: test.body})
				}
				_, err := InspectPackage(context.Background(), source)
				if (err == nil) != test.valid || (err != nil && strings.Contains(err.Error(), strings.Repeat("文", 40))) {
					t.Fatalf("%s accepted=%v; want %v: %v", format, err == nil, test.valid, err)
				}
			}
		})
	}
}

func TestSkillMissingOrUnreferencedDocument(t *testing.T) {
	manifest := skillManifest()
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"zip", "tgz"} {
		source := skillArchive(t, format, map[string][]byte{manifestName: raw, "unrelated/SKILL.md": []byte("text")})
		if _, err := InspectPackage(context.Background(), source); err == nil {
			t.Fatal("missing declared entry accepted")
		}
	}
	legacy := basicManifest("example.legacy")
	source := writePackage(t, legacy)
	if err = os.WriteFile(filepath.Join(source, "SKILL.md"), []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = InspectPackage(context.Background(), source); err != nil {
		t.Fatalf("unreferenced legacy file changed package support: %v", err)
	}
}
