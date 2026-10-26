package plugin

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestExternalModuleBuildsWithoutHostDependencies(t *testing.T) {
	root, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	module := "module example.org/independent-plugin\n\ngo 1.22\n\nrequire github.com/Syngnat/GoNavi/sdk/go v0.0.0\nreplace github.com/Syngnat/GoNavi/sdk/go => " + strconv.Quote(filepath.ToSlash(root)) + "\n"
	source := "package main\nimport (\"context\"; plugin \"github.com/Syngnat/GoNavi/sdk/go\")\nfunc main(){ _ = plugin.NewServer(plugin.Options{}).ServeStdio(context.Background()) }\n"
	for name, content := range map[string]string{"go.mod": module, "main.go": source} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "build", ".")
	command.Dir = dir
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("external build: %v\n%s", err, output)
	}
	deps := exec.CommandContext(ctx, "go", "list", "-deps", ".")
	deps.Dir = dir
	deps.Env = command.Env
	output, err = deps.CombinedOutput()
	if err != nil {
		t.Fatalf("list deps: %v\n%s", err, output)
	}
	if strings.Contains(string(output), "GoNavi-Wails/") {
		t.Fatal("SDK depends on host internal packages")
	}
}
