package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func nativeSkillManifest() plugin.Manifest {
	manifest := skillManifest()
	manifest.Name = "Native package with Skills"
	manifest.Backend = &plugin.Backend{Default: &plugin.Entry{Executable: "placeholder", Runtime: "native"}}
	manifest.Contributes.Commands = []plugin.Command{{ID: "hello", Title: "Say hello", Effect: "read"}}
	return manifest
}

func TestNativePackageIncludesCapturedSkills(t *testing.T) {
	manifest := nativeSkillManifest()
	body := []byte("---\r\nname: text-only\r\nrequired_tools: [write]\r\n---\r\n# Opaque reference\n")
	source := writeSkillSource(t, manifest, body)
	output := filepath.Join(t.TempDir(), "native-with-skills")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := buildPackage(ctx, options{source: "../hello", manifest: source, output: output, goos: runtime.GOOS, goarch: runtime.GOARCH}); err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(output, filepath.FromSlash(manifest.Contributes.Skills[0].Entry)))
	if err != nil || !bytes.Equal(copied, body) {
		t.Fatalf("native Skill bytes omitted or changed: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(output, "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var packaged plugin.Manifest
	if err = json.Unmarshal(raw, &packaged); err != nil {
		t.Fatal(err)
	}
	if len(packaged.Contributes.Skills) != 1 || packaged.Contributes.Skills[0].Name != manifest.Contributes.Skills[0].Name || len(packaged.Permissions) != 1 || packaged.Permissions[0] != "ai.skills" {
		t.Fatal("opaque text changed manifest authority")
	}
	entry, exists := packaged.Backend.Platforms[runtime.GOOS+"/"+runtime.GOARCH]
	if !exists {
		t.Fatal("native backend entry missing")
	}
	if _, err = os.Stat(filepath.Join(output, filepath.FromSlash(entry.Executable))); err != nil {
		t.Fatal(err)
	}
}

func TestNativeSkillsValidateBeforeCompilerAndStaging(t *testing.T) {
	binary := "bin/plugin"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	tests := []struct {
		name         string
		entry        string
		missing      bool
		body         []byte
		noPermission bool
		want         string
	}{
		{name: "binary parent conflict", entry: binary + "/SKILL.md", want: "conflict"},
		{name: "binary case alias", entry: "BIN/notes/SKILL.md", want: "case-colliding"},
		{name: "manifest conflict", entry: "gonavi.plugin.json/SKILL.md", want: "conflict"},
		{name: "manifest case alias", entry: "Gonavi.Plugin.Json/SKILL.md", want: "case-colliding"},
		{name: "missing", missing: true},
		{name: "invalid text", body: []byte{0xff}},
		{name: "missing permission", noPermission: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := nativeSkillManifest()
			body := []byte("# Reference")
			if test.body != nil {
				body = test.body
			}
			source := writeSkillSource(t, manifest, body)
			if test.entry != "" {
				manifest.Contributes.Skills[0].Entry = test.entry
			}
			if test.noPermission {
				manifest.Permissions = nil
			}
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(source, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if test.missing {
				target := filepath.Join(filepath.Dir(source), filepath.FromSlash(manifest.Contributes.Skills[0].Entry))
				if err = os.Remove(target); err != nil {
					t.Fatal(err)
				}
			}
			output := filepath.Join(t.TempDir(), "must-not-exist")
			t.Setenv("PATH", t.TempDir())
			err = buildPackage(context.Background(), options{source: "missing-go-source", manifest: source, output: output, goos: runtime.GOOS, goarch: runtime.GOARCH})
			if err == nil {
				t.Fatal("invalid native Skill declaration accepted")
			}
			if test.want != "" && !strings.Contains(err.Error(), test.want) {
				t.Fatalf("wrong rejection: %v", err)
			}
			if _, statErr := os.Stat(output); !errors.Is(statErr, os.ErrNotExist) {
				t.Fatal("compiler staging happened before Skill validation")
			}
		})
	}
}

func TestCapturedSkillsAreNotRereadDuringStaging(t *testing.T) {
	manifest := nativeSkillManifest()
	original := []byte("# Captured before compilation")
	source := writeSkillSource(t, manifest, original)
	documents, err := prepareNativeSkills(context.Background(), source, manifest, "bin/plugin")
	if err != nil {
		t.Fatal(err)
	}
	sourceBody := filepath.Join(filepath.Dir(source), filepath.FromSlash(manifest.Contributes.Skills[0].Entry))
	if err = os.WriteFile(sourceBody, []byte("# Changed after validation"), 0600); err != nil {
		t.Fatal(err)
	}
	output := t.TempDir()
	if err = writeCapturedSkills(context.Background(), output, documents); err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(output, filepath.FromSlash(manifest.Contributes.Skills[0].Entry)))
	if err != nil || !bytes.Equal(copied, original) {
		t.Fatalf("staging reread mutable source: %v", err)
	}
}
