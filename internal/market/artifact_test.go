package market

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidatePackageExactBytesAndMetadata(t *testing.T) {
	for _, format := range []string{".zip", ".tgz", ".tar.gz", ".ZIP"} {
		t.Run(format, func(t *testing.T) {
			builderFormat := strings.ToLower(format)
			contents := artifactTestArchive(t, builderFormat, artifactTestEntries(artifactTestManifest))
			filename := artifactTestWrite(t, format, contents)
			validated, err := ValidatePackage(context.Background(), filename)
			if err != nil {
				t.Fatal(err)
			}
			if string(validated.Manifest) != artifactTestManifest || validated.SHA256 != artifactTestDigest(contents) || validated.SizeBytes != int64(len(contents)) {
				t.Fatalf("validated bytes differ: %+v", validated)
			}
			if validated.ID != "example.fixture" || validated.Name != "Fixture" || validated.Version != "1.2.3" || validated.Description != "An inert fixture" || validated.Author != "Test" || validated.MinHostVersion != "0.9.0" {
				t.Fatalf("metadata differs: %+v", validated)
			}
			if !slices.Equal(validated.Platforms, []string{"linux/amd64", "windows/amd64"}) {
				t.Fatalf("platforms = %v", validated.Platforms)
			}
			entries, err := os.ReadDir(filepath.Dir(filename))
			if err != nil || len(entries) != 1 {
				t.Fatalf("validation extracted or executed files: %v, %v", entries, err)
			}
		})
	}
}

func TestSafeArtifactPathMatchesHostSegmentLimits(t *testing.T) {
	if err := safeArtifactPath(strings.Repeat("a", 240)); err != nil {
		t.Fatal(err)
	}
	if err := safeArtifactPath(strings.Repeat("文", 80)); err != nil {
		t.Fatal(err)
	}
	if err := safeArtifactPath(strings.Repeat("a/", 32) + "b"); err != nil {
		t.Fatal(err)
	}
	wide := strings.Repeat(strings.Repeat("文", 77)+"/", 12) + "file"
	if utf8.RuneCountInString(wide) > 1024 {
		t.Fatal("multibyte fixture exceeds 1024 characters")
	}
	for _, name := range []string{strings.Repeat("a", 241), strings.Repeat("a/", 33) + "b", wide, strings.Repeat("文", 81), "a\tb", "a<b"} {
		if err := safeArtifactPath(name); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
}

func TestValidatePackageRejectsUnsafePaths(t *testing.T) {
	paths := []string{"../escape", "/absolute", "a/../../escape", "a/./b", "a//b", "a\\b", "C:drive", "a:b", "a\x00b", "a\nb", "a. ", "a.", "NUL.txt", "NUL .txt", "con", "COM0", "COM1", "LPT0.txt", "LPT9.log", "COM².txt", "CLOCK$", "CONOUT$", "a?b", "a*b", "a|b", "a<b", "a\"b", "a\tb", strings.Repeat("a", 256), string([]byte{0xff})}
	for _, format := range []string{".zip", ".tgz"} {
		for _, name := range paths {
			t.Run(format+"/"+fmt.Sprintf("%q", name), func(t *testing.T) {
				// TAR encodes names as NUL-terminated fields; its writer cannot
				// represent an embedded NUL. Check the path rule directly here.
				if format == ".tgz" && strings.ContainsRune(name, 0) {
					if err := safeArtifactPath(name); err == nil {
						t.Fatal("accepted embedded nul")
					}
					return
				}
				entries := append(artifactTestEntries(artifactTestManifest), artifactTestEntry{name: name})
				filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
				_, err := ValidatePackage(context.Background(), filename)
				if err == nil || strings.Contains(err.Error(), filename) || (nameLooksSecret(name) && strings.Contains(err.Error(), name)) {
					t.Fatalf("accepted unsafe path: %v", err)
				}
			})
		}
	}
}

func TestValidatePackageRejectsPathConflicts(t *testing.T) {
	cases := []struct {
		name  string
		paths []string
	}{
		{name: "duplicate", paths: []string{"asset", "asset"}},
		{name: "case", paths: []string{"Asset", "asset"}},
		{name: "unicode case", paths: []string{"K", "K"}},
		{name: "parent case", paths: []string{"Dir/one", "dir/two"}},
		{name: "file parent", paths: []string{"file", "file/child"}},
		{name: "implicit directory replaced", paths: []string{"file/child", "file"}},
		{name: "manifest case", paths: []string{"GONAVI.PLUGIN.JSON"}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				entries := artifactTestEntries(artifactTestManifest)
				for _, name := range test.paths {
					entries = append(entries, artifactTestEntry{name: name})
				}
				if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, format, artifactTestArchive(t, format, entries))); err == nil {
					t.Fatal("accepted conflicting paths")
				}
			})
		}
	}
}

func TestValidatePackageLimits(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format+"/manifest limit", func(t *testing.T) {
			for _, extra := range []int{0, 1} {
				manifest := artifactTestManifest + strings.Repeat(" ", maxArtifactManifestBytes-len(artifactTestManifest)+extra)
				filename := artifactTestWrite(t, format, artifactTestArchive(t, format, artifactTestEntries(manifest)))
				_, err := ValidatePackage(context.Background(), filename)
				if (err == nil) != (extra == 0) {
					t.Fatalf("manifest bytes %d: %v", len(manifest), err)
				}
			}
		})
		t.Run(format+"/file count", func(t *testing.T) {
			entries := []artifactTestEntry{{name: artifactManifestName, body: []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.fixture","name":"Fixture","version":"1.0.0","permissions":[]}`)}}
			for i := 1; i < maxArtifactFiles; i++ {
				entries = append(entries, artifactTestEntry{name: fmt.Sprintf("nested/files/file-%04d", i)})
			}
			filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err != nil {
				t.Fatalf("maximum file count rejected: %v", err)
			}
			entries = append(entries, artifactTestEntry{name: "one-too-many"})
			filename = artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted excessive file count")
			}
		})
	}
}

func TestArtifactIndexExpansionAndDirectories(t *testing.T) {
	index := artifactIndex{paths: make(map[string]artifactPath)}
	if err := index.add("dir/file", false, maxArtifactExpandedBytes); err != nil {
		t.Fatal(err)
	}
	if err := index.add("dir/", true, 0); err != nil {
		t.Fatalf("explicit parent after implicit parent: %v", err)
	}
	for _, entry := range []struct {
		name string
		dir  bool
		size int64
	}{{"more", false, 1}, {"bad/", true, 1}, {"negative", false, -1}, {"dir/", true, 0}} {
		if err := index.add(entry.name, entry.dir, entry.size); err == nil {
			t.Fatalf("accepted invalid entry %+v", entry)
		}
	}
}

func TestValidatePackageInputAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ValidatePackage(ctx, "missing.zip"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation = %v", err)
	}
	for _, filename := range []string{filepath.Join(t.TempDir(), "missing.zip"), t.TempDir(), artifactTestWrite(t, ".zip", nil), artifactTestWrite(t, ".exe", []byte("not an archive"))} {
		if _, err := ValidatePackage(context.Background(), filename); err == nil {
			t.Fatalf("accepted invalid input %q", filename)
		}
	}
	filename := artifactTestWrite(t, ".zip", nil)
	if err := os.Truncate(filename, MaxArtifactBytes+1); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("accepted oversized compressed artifact")
	}
}

func nameLooksSecret(name string) bool {
	for _, char := range []rune{'<', '>', '"', '|', '?', '*', '\t', '\n'} {
		if strings.ContainsRune(name, char) {
			return true
		}
	}
	return false
}
