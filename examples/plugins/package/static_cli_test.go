package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestPrebuiltStaticPackagerRunsWithUnusablePATH(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	binary := filepath.Join(t.TempDir(), "packager")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build development packager: %v\n%s", err, output)
	}
	source, err := filepath.Abs("../skills/gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "static-package")
	command := exec.CommandContext(ctx, binary, "-static", "-manifest", source, "-source", "missing-and-must-not-be-compiled", "-output", output)
	command.Env = append(os.Environ(), "PATH="+t.TempDir())
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compiler-free static command: %v\n%s", err, result)
	}
	expected, err := os.ReadFile(filepath.Join(filepath.Dir(source), "skills", "read-only-investigation", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(output, "skills", "read-only-investigation", "SKILL.md"))
	if err != nil || !bytes.Equal(expected, actual) {
		t.Fatalf("packaged example bytes changed: %v", err)
	}
	originalManifest, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	outputManifest, err := os.ReadFile(filepath.Join(output, "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalManifest, outputManifest) {
		t.Fatal("static manifest changed")
	}
}

func TestStaticRootDocumentAndSharedEntryAreSupported(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Entry = "SKILL.md"
	second := manifest.Contributes.Skills[0]
	second.ID = "second_reference"
	manifest.Contributes.Skills = append(manifest.Contributes.Skills, second)
	// The contract requires nonempty bytes, not nonblank prose. Do not invent a YAML/content parser.
	source := writeSkillSource(t, manifest, []byte(" \n"))
	output := filepath.Join(t.TempDir(), "package")
	if err := buildPackage(context.Background(), options{static: true, manifest: source, output: output}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("shared entry duplicated or arbitrary files copied: %v", entries)
	}
}
