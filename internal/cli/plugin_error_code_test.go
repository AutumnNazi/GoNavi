package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Redacting the package path must not flatten the error: the CLI still has to report the
// specific policy code instead of a generic failure.
func TestPluginInstallDigestMismatchKeepsItsPolicyCode(t *testing.T) {
	root := t.TempDir()
	source := t.TempDir()
	copySkillExample(t, source, "1.0.0")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	wrong := strings.Repeat("a", 64)
	code := runPlugin(ctx, []string{"--root", root, "install", "--digest", wrong, "--trust", source}, &stdout, &stderr)
	if code != ExitPolicyDenied {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	var report struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(stderr.Bytes(), &report); err != nil || report.Code != "plugin_digest_mismatch" {
		t.Fatalf("code=%q err=%v stderr=%s", report.Code, err, stderr.String())
	}
	if strings.Contains(stderr.String(), source) {
		t.Fatalf("path leaked: %s", stderr.String())
	}
}
