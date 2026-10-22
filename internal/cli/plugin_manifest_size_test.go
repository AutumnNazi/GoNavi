package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckRejectsOversizedManifest(t *testing.T) {
	raw := append([]byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"description":"`), []byte(strings.Repeat("文", 400000))...)
	raw = append(raw, []byte(`"}`)...)
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("文", 40)) || strings.Contains(stderr.String(), source) {
		t.Fatalf("oversized manifest: exit=%d stderr=%s", code, stderr.String())
	}
}
