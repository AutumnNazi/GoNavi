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

func TestPluginCheckHidesNestedUnknownField(t *testing.T) {
	name := strings.Repeat("文", 80)
	source := t.TempDir()
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"panels":[{"id":"main","title":"Panel","body":{"type":"text","text":"ok","` + name + `":true}}]}}`)
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stdout.String()+stderr.String(), strings.Repeat("文", 40)) || strings.Contains(stderr.String(), source) {
		t.Fatalf("nested field leaked: exit=%d stderr=%s", code, stderr.String())
	}
}
