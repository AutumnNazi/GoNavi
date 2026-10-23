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

func TestPluginCheckHidesMissingEntryName(t *testing.T) {
	source := t.TempDir()
	name := strings.Repeat("文", 80)
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"backend":{"default":{"executable":"` + name + `"}}}`)
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stdout.String()+stderr.String(), strings.Repeat("文", 40)) || strings.Contains(stderr.String(), source) {
		t.Fatalf("missing entry leaked: exit=%d stderr=%s", code, stderr.String())
	}
}
