package plugin

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectRejectsForbiddenArchiveNames(t *testing.T) {
	for _, name := range []string{"a<b", "a|b", "a?b", "a*b", "a\"b", "a\tb"} {
		t.Run(name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "bad.zip")
			handle, err := os.Create(file)
			if err != nil {
				t.Fatal(err)
			}
			writer := zip.NewWriter(handle)
			entry, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = entry.Write([]byte("x")); err != nil {
				t.Fatal(err)
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			handle.Close()
			_, err = InspectPackage(context.Background(), file)
			if err == nil || !strings.Contains(err.Error(), "path") || strings.Contains(err.Error(), name) || strings.Contains(err.Error(), file) {
				t.Fatal(err)
			}
		})
	}
}
