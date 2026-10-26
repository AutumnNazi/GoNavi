package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"
)

func pluginFailureReport(t *testing.T, args ...string) (int, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, args, &stdout, &stderr)
	var report struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(stderr.Bytes(), &report); err != nil {
		t.Fatalf("not a JSON failure: exit=%d stderr=%s", code, stderr.String())
	}
	return code, report.Code
}

// Sanitising a message must never change which policy code the CLI reports.
func TestPluginFailureCodesStaySpecific(t *testing.T) {
	root := t.TempDir()
	source := t.TempDir()
	copySkillExample(t, source, "1.0.0")
	digest := pluginDigest(t, root, source)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", root, "install", "--digest", digest, "--trust", source}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("install: %s", stderr.String())
	}
	for _, test := range []struct {
		name   string
		args   []string
		code   int
		report string
	}{
		{name: "safe mode enable", args: []string{"--safe-mode", "enable", "sdk.examples.skills"}, code: ExitPolicyDenied, report: "plugin_safe_mode"},
		{name: "unknown plugin", args: []string{"enable", "does.not.exist"}, code: ExitExecution, report: "plugin_not_found"},
		{name: "disabled invoke", args: []string{"invoke", "sdk.examples.skills", "hello"}, code: ExitPolicyDenied, report: "plugin_disabled"},
	} {
		t.Run(test.name, func(t *testing.T) {
			code, report := pluginFailureReport(t, append([]string{"--root", root}, test.args...)...)
			if code != test.code || report != test.report {
				t.Fatalf("exit=%d code=%s; want %d %s", code, report, test.code, test.report)
			}
		})
	}
}
