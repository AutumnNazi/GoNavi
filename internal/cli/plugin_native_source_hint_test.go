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

func TestPluginCheckNativeSourceTreePointsAtPackagedOutput(t *testing.T) {
	source := t.TempDir()
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.native","name":"Native","version":"1.0.0","permissions":[],"backend":{"default":{"executable":"bin/plugin"}}}`
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	if code == ExitSuccess || !strings.Contains(stderr.String(), "packaged output") || strings.Contains(stderr.String(), source) {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
}
