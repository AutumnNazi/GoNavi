package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestPluginReplaceInSafeModeLeavesEnabledPluginUntouched(t *testing.T) {
	root := t.TempDir()
	first := t.TempDir()
	copySkillExample(t, first, "1.0.0")
	digest := pluginDigest(t, root, first)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", root, "install", "--digest", digest, "--trust", first}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("install: %s", stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "enable", "sdk.examples.skills"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("enable: %s", stderr.String())
	}
	second := t.TempDir()
	copySkillExample(t, second, "2.0.0")
	nextDigest := pluginDigest(t, root, second)
	stdout.Reset()
	stderr.Reset()
	code := runPlugin(ctx, []string{"--root", root, "--safe-mode", "replace", "--digest", nextDigest, "--trust", second}, &stdout, &stderr)
	if code != ExitPolicyDenied || !strings.Contains(stderr.String(), "disable it first") {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code = runPlugin(ctx, []string{"--root", root, "list"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("list: %s", stderr.String())
	}
	var listed []struct {
		Manifest struct {
			Version string `json:"version"`
		} `json:"manifest"`
		DesiredEnabled bool `json:"desiredEnabled"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &listed); err != nil || len(listed) != 1 {
		t.Fatalf("list: %v %s", err, stdout.String())
	}
	if listed[0].Manifest.Version != "1.0.0" || !listed[0].DesiredEnabled {
		t.Fatalf("safe mode changed the record: %s", stdout.String())
	}
}
