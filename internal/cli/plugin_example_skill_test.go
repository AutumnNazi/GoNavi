package cli

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckShippedStaticSkillExample(t *testing.T) {
	source := filepath.Join("..", "..", "examples", "plugins", "skills")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
	cancel()
	if code != ExitSuccess || !strings.Contains(stdout.String(), "sdk.examples.skills") {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
}
