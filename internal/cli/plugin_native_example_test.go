package cli

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckAcceptsNativeExampleBuiltByPackager(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go toolchain is unavailable")
	}
	examples, err := filepath.Abs(filepath.Join("..", "..", "examples", "plugins"))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	buildCtx, cancelBuild := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancelBuild()
	command := exec.CommandContext(buildCtx, "go", "run", "./package",
		"-manifest", filepath.Join("hello", "gonavi.plugin.json"),
		"-source", filepath.Join("hello"),
		"-output", output)
	command.Dir = examples
	var buildOut, buildErr bytes.Buffer
	command.Stdout = &buildOut
	command.Stderr = &buildErr
	if err = command.Run(); err != nil {
		t.Fatalf("packager failed: %v stdout=%s stderr=%s", err, buildOut.String(), buildErr.String())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", output}, &stdout, &stderr)
	if code != ExitSuccess || !strings.Contains(stdout.String(), "example.hello") {
		t.Fatalf("exit=%d stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
}
