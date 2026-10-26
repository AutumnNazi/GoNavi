package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginRealHelloLifecycle(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	packagePath := buildHelloPackage(t)
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	run := func(args ...string) []byte {
		t.Helper()
		var stdout, stderr bytes.Buffer
		full := append([]string{"--root", root}, args...)
		if code := runPlugin(ctx, full, &stdout, &stderr); code != ExitSuccess {
			t.Fatalf("%v: exit=%d stderr=%s", args, code, stderr.String())
		}
		return stdout.Bytes()
	}
	var inspection plugin.Inspection
	if err := json.Unmarshal(run("inspect", packagePath), &inspection); err != nil {
		t.Fatal(err)
	}
	run("check", packagePath)
	run("install", "--digest", inspection.Digest, "--trust", packagePath)
	var statuses []plugin.Status
	if err := json.Unmarshal(run("list"), &statuses); err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 1 || statuses[0].DesiredEnabled || statuses[0].State != plugin.StateDisabled {
		t.Fatalf("initial status: %+v", statuses)
	}
	run("enable", "example.hello")
	var result struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(run("invoke", "--args", `{"name":"external SDK"}`, "example.hello", "hello"), &result); err != nil {
		t.Fatal(err)
	}
	if result.Message != "Hello, external SDK!" {
		t.Fatalf("real handler: %+v", result)
	}
	t.Setenv("GONAVI_DISABLE_PLUGINS", "1")
	run("disable", "example.hello")
	run("remove", "example.hello")
	if err := json.Unmarshal(run("list"), &statuses); err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 0 {
		t.Fatalf("remaining records: %+v", statuses)
	}
}

func buildHelloPackage(t *testing.T) string {
	t.Helper()
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "hello-package")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "run", "./package", "-source", "./hello", "-manifest", "./hello/gonavi.plugin.json", "-output", output)
	command.Dir = filepath.Join(repo, "examples", "plugins")
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	logs, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("build external hello: %v\n%s", err, logs)
	}
	return output
}
