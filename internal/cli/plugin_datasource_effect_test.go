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

	"GoNavi-Wails/internal/plugin"
)

func TestPluginCheckRejectsDataSourceWriteEffect(t *testing.T) {
	allowed := map[string]bool{"": true, "read": true, "unknown": true}
	for _, effect := range []string{"", "read", "unknown", "write", "WRITE", "sideeffect"} {
		source := writeDataSourcePackage(t, effect)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		var stdout, stderr bytes.Buffer
		code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
		cancel()
		if !allowed[effect] {
			var report struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			want := "unsupported command effect"
			if effect == "write" {
				want = "cannot declare a write effect"
			}
			if code == ExitSuccess || json.Unmarshal(stderr.Bytes(), &report) != nil || !strings.Contains(report.Message, want) || strings.Contains(report.Message, source) {
				t.Fatalf("write effect error: exit=%d stderr=%s", code, stderr.String())
			}
			continue
		}
		if code != ExitSuccess {
			t.Fatalf("read effect failed: %s", stderr.String())
		}
	}
}

func TestPluginInstallKeepsUnknownDataSourceDisabled(t *testing.T) {
	root := t.TempDir()
	source := writeDataSourcePackage(t, "unknown")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", root, "inspect", source}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("inspect: %s", stderr.String())
	}
	var inspection plugin.Inspection
	if err := json.Unmarshal(stdout.Bytes(), &inspection); err != nil || inspection.Manifest.Contributes.Commands[0].Effect != "unknown" {
		t.Fatalf("inspection: %s %v", stdout.String(), err)
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "install", "--digest", inspection.Digest, "--trust", source}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("install: %s", stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	write := writeDataSourcePackage(t, "write")
	if code := runPlugin(ctx, []string{"--root", root, "install", "--digest", inspection.Digest, "--trust", write}, &stdout, &stderr); code == ExitSuccess || !strings.Contains(stderr.String(), "cannot declare a write effect") || strings.Contains(stderr.String(), write) {
		t.Fatalf("write install: exit=%d stderr=%s", code, stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "list"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatal(stderr.String())
	}
	var statuses []plugin.Status
	if err := json.Unmarshal(stdout.Bytes(), &statuses); err != nil || len(statuses) != 1 || statuses[0].Manifest.ID != "example.source" || statuses[0].DesiredEnabled || statuses[0].State == plugin.StateRunning {
		t.Fatalf("list: %s %v", stdout.String(), err)
	}
}

func writeDataSourcePackage(t *testing.T, effect string) string {
	t.Helper()
	source := t.TempDir()
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.source","name":"Source","version":"1.0.0","permissions":["data.sources"],"backend":{"default":{"executable":"plugin","runtime":"native"}},"contributes":{"commands":[{"id":"database","title":"Database","effect":"` + effect + `"}],"dataSources":[{"id":"fixture","name":"Fixture","dialect":"sqlite","command":"database","readOnly":true}]}}`
	for name, body := range map[string]string{"gonavi.plugin.json": manifest, "plugin": "not executed"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return source
}
