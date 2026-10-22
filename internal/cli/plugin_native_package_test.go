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

func TestPluginCheckAcceptsPackagedNativePlatform(t *testing.T) {
	source := t.TempDir()
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.native","name":"Native","version":"1.0.0","permissions":[],"backend":{"platforms":{"windows/amd64":{"executable":"bin/plugin.exe"}}}}`
	if err := os.MkdirAll(filepath.Join(source, "bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "bin", "plugin.exe"), []byte("MZ fake native payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	cancel()
	if code != ExitSuccess || !strings.Contains(stdout.String(), "example.native") || !strings.Contains(stdout.String(), "windows/amd64") {
		t.Fatalf("exit=%d stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
}
