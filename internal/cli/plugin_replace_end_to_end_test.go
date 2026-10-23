package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func copySkillExample(t *testing.T, directory, version string) {
	t.Helper()
	source := filepath.Join("..", "..", "examples", "plugins", "skills")
	for _, name := range []string{"gonavi.plugin.json", "skills/read-only-investigation/SKILL.md", "skills/read-only-investigation/REFERENCE.md"} {
		body, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		if name == "gonavi.plugin.json" {
			body = []byte(strings.Replace(string(body), `"version": "1.0.0"`, `"version": "`+version+`"`, 1))
		}
		target := filepath.Join(directory, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func pluginDigest(t *testing.T, root, source string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", root, "inspect", source}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("inspect: %s", stderr.String())
	}
	var view struct {
		Digest string `json:"digest"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &view); err != nil || view.Digest == "" {
		t.Fatalf("digest: %v %s", err, stdout.String())
	}
	return view.Digest
}

func TestPluginReplaceKeepsEnabledInstalledPlugin(t *testing.T) {
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
	if nextDigest == digest {
		t.Fatal("fixture digest did not change")
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "replace", "--digest", nextDigest, "--trust", second}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("replace: %s", stderr.String())
	}
	var status struct {
		Manifest struct {
			Version string `json:"version"`
		} `json:"manifest"`
		DesiredEnabled bool `json:"desiredEnabled"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Manifest.Version != "2.0.0" || !status.DesiredEnabled {
		t.Fatalf("replace result: %s", stdout.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "list"}, &stdout, &stderr); code != ExitSuccess {
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
	if listed[0].Manifest.Version != "2.0.0" || !listed[0].DesiredEnabled {
		t.Fatalf("installed state: %s", stdout.String())
	}
}
