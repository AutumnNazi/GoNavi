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
	"unicode/utf8"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func skillManifest() plugin.Manifest {
	return plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.skills", Name: "Static Skills", Version: "1.0.0", Permissions: []string{"ai.skills"}, Contributes: &plugin.Contributions{Skills: []plugin.Skill{{ID: "investigate", Name: "Read-only investigation", Description: "Use when investigating a read-only database issue.", Entry: "skills/investigate/SKILL.md"}}}}
}

func writeSkillSource(t *testing.T, manifest plugin.Manifest, body []byte) string {
	t.Helper()
	root := t.TempDir()
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "gonavi.plugin.json")
	if err = os.WriteFile(manifestPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	for _, skill := range manifest.Contributes.Skills {
		if validateStaticSkillEntry(skill.Entry) != nil {
			continue
		}
		path := filepath.Join(root, filepath.FromSlash(skill.Entry))
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return manifestPath
}

func TestStaticPackagePreservesOnlyDeclaredBytesWithoutCompiler(t *testing.T) {
	body := []byte("# Read-only investigation\r\n\nUnicode evidence: 只读\n")
	manifest := skillManifest()
	source := writeSkillSource(t, manifest, body)
	if err := os.WriteFile(filepath.Join(filepath.Dir(source), "unused-script.sh"), []byte("must not run"), 0700); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	// Static mode must succeed even when neither a Go compiler nor any program is on PATH.
	t.Setenv("PATH", t.TempDir())
	if err = buildPackage(context.Background(), options{static: true, manifest: source, source: "missing-go-source", output: output}); err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(output, filepath.FromSlash(manifest.Contributes.Skills[0].Entry)))
	if err != nil || !bytes.Equal(copied, body) {
		t.Fatalf("Skill bytes changed: %v", err)
	}
	copiedManifest, err := os.ReadFile(filepath.Join(output, "gonavi.plugin.json"))
	if err != nil || !bytes.Equal(copiedManifest, raw) {
		t.Fatalf("manifest bytes changed: %v", err)
	}
	var files []string
	if err = filepath.WalkDir(output, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() {
			relative, err := filepath.Rel(output, path)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(relative))
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("unexpected bundled files: %v", files)
	}
	if _, err = os.Stat(filepath.Join(output, "bin")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("static mode created executable directory")
	}
}

func TestStaticPackageRejectsInvalidDeclarationsBeforeCreatingOutput(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*plugin.Manifest)
	}{
		{name: "backend", mutate: func(m *plugin.Manifest) { m.Backend = &plugin.Backend{Default: &plugin.Entry{Executable: "payload"}} }},
		{name: "window", mutate: func(m *plugin.Manifest) { m.Window = &plugin.Window{Entry: "window.html"} }},
		{name: "commands", mutate: func(m *plugin.Manifest) { m.Contributes.Commands = []plugin.Command{{ID: "run"}} }},
		{name: "data source", mutate: func(m *plugin.Manifest) { m.Contributes.DataSources = []plugin.DataSource{{ID: "db"}} }},
		{name: "panel", mutate: func(m *plugin.Manifest) { m.Contributes.Panels = []plugin.Panel{{ID: "ui"}} }},
		{name: "AI provider", mutate: func(m *plugin.Manifest) { m.Contributes.AIProviders = []plugin.AIProvider{{ID: "model"}} }},
		{name: "exporter", mutate: func(m *plugin.Manifest) { m.Contributes.Exporters = []plugin.Exporter{{ID: "ndjson"}} }},
		{name: "missing permission", mutate: func(m *plugin.Manifest) { m.Permissions = nil }},
		{name: "missing skills", mutate: func(m *plugin.Manifest) { m.Contributes.Skills = nil }},
		{name: "too many", mutate: func(m *plugin.Manifest) { m.Contributes.Skills = make([]plugin.Skill, 17) }},
		{name: "duplicate ID", mutate: func(m *plugin.Manifest) { m.Contributes.Skills = append(m.Contributes.Skills, m.Contributes.Skills[0]) }},
		{name: "invalid ID", mutate: func(m *plugin.Manifest) { m.Contributes.Skills[0].ID = "Uppercase" }},
		{name: "blank name", mutate: func(m *plugin.Manifest) { m.Contributes.Skills[0].Name = " " }},
		{name: "oversize UTF8 name", mutate: func(m *plugin.Manifest) { m.Contributes.Skills[0].Name = strings.Repeat("只", 86) }},
		{name: "description NUL", mutate: func(m *plugin.Manifest) { m.Contributes.Skills[0].Description = "bad\x00description" }},
		{name: "wrong API", mutate: func(m *plugin.Manifest) { m.APIVersion = 2 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := skillManifest()
			test.mutate(&manifest)
			source := writeSkillSource(t, manifest, []byte("# Valid"))
			output := filepath.Join(t.TempDir(), "package")
			if err := buildPackage(context.Background(), options{static: true, manifest: source, output: output}); err == nil {
				t.Fatal("accepted invalid static manifest")
			}
			if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("invalid declaration created output")
			}
		})
	}
}

func TestStaticSkillPaths(t *testing.T) {
	for _, entry := range []string{"SKILL.md", "skills/triage/SKILL.md", strings.Repeat("b", 240) + "/SKILL.md", strings.Repeat("c/", 32) + "SKILL.md", strings.Repeat("文", 80) + "/SKILL.md"} {
		if err := validateStaticSkillEntry(entry); err != nil {
			t.Fatalf("valid path %q: %v", entry, err)
		}
	}
	for _, entry := range []string{"", "../SKILL.md", "/SKILL.md", "C:/SKILL.md", `skills\triage\SKILL.md`, "skills/./SKILL.md", "skills//SKILL.md", "skills/../SKILL.md", "skills /SKILL.md", "skills./SKILL.md", "NUL/SKILL.md", "COM0/SKILL.md", "CLOCK$/SKILL.md", "COM¹/SKILL.md", "skills/skill.md", "skills/README.md", "skills/\x00/SKILL.md", "skills/?/SKILL.md", "skills/a<b/SKILL.md", "skills/a|b/SKILL.md", "skills/a\tb/SKILL.md", strings.Repeat("a", 241) + "/SKILL.md", strings.Repeat("a/", 33) + "SKILL.md"} {
		t.Run(entry, func(t *testing.T) {
			if err := validateStaticSkillEntry(entry); err == nil {
				t.Fatalf("accepted unsafe path %q", entry)
			}
		})
	}
	wide := strings.Repeat(strings.Repeat("文", 77)+"/", 12) + "SKILL.md"
	if utf8.RuneCountInString(wide) > 1024 {
		t.Fatal("multibyte fixture exceeds 1024 characters")
	}
	for _, entry := range []string{wide, strings.Repeat("文", 81) + "/SKILL.md"} {
		if err := validateStaticSkillEntry(entry); err == nil {
			t.Fatalf("accepted multibyte path %q", entry)
		}
	}
	paths := map[string]string{"gonavi.plugin.json": "gonavi.plugin.json"}
	files := map[string]bool{"gonavi.plugin.json": true}
	if err := registerStaticEntry("skills/one/SKILL.md", paths, files); err != nil {
		t.Fatal(err)
	}
	if err := registerStaticEntry("Skills/two/SKILL.md", paths, files); err == nil {
		t.Fatal("case collision accepted")
	}
	if err := registerStaticEntry("gonavi.plugin.json/SKILL.md", paths, files); err == nil {
		t.Fatal("manifest directory collision accepted")
	}
}

func TestStaticSkillBodyLimitsAndMissingFile(t *testing.T) {
	tests := []struct {
		name    string
		body    []byte
		missing bool
		valid   bool
	}{
		{name: "empty"}, {name: "invalid UTF8", body: []byte{0xff}}, {name: "NUL", body: []byte{'a', 0, 'b'}},
		{name: "too large", body: bytes.Repeat([]byte{'a'}, maxStaticSkillBytes+1)},
		{name: "exact limit", body: bytes.Repeat([]byte{'a'}, maxStaticSkillBytes), valid: true},
		{name: "multibyte exact", body: []byte(strings.Repeat("文", 21845)), valid: true},
		{name: "multibyte over", body: []byte(strings.Repeat("文", 21846))},
		{name: "missing", body: []byte("# Valid"), missing: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := skillManifest()
			source := writeSkillSource(t, manifest, test.body)
			if test.missing {
				target := filepath.Join(filepath.Dir(source), filepath.FromSlash(manifest.Contributes.Skills[0].Entry))
				if err := os.Remove(target); err != nil {
					t.Fatal(err)
				}
			}
			err := buildPackage(context.Background(), options{static: true, manifest: source, output: filepath.Join(t.TempDir(), "package")})
			if (err == nil) != test.valid || (err != nil && strings.Contains(err.Error(), strings.Repeat("文", 40))) {
				t.Fatalf("static body validation: %v", err)
			}
		})
	}
}

func TestStaticPackageCancellationAndExistingOutput(t *testing.T) {
	source := writeSkillSource(t, skillManifest(), []byte("# Valid"))
	output := filepath.Join(t.TempDir(), "package")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := buildPackage(ctx, options{static: true, manifest: source, output: output}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled build: %v", err)
	}
	if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled build created output")
	}
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(output, "keep.txt")
	if err := os.WriteFile(sentinel, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := buildPackage(context.Background(), options{static: true, manifest: source, output: output}); err == nil {
		t.Fatal("replaced existing output")
	}
	if value, err := os.ReadFile(sentinel); err != nil || string(value) != "keep" {
		t.Fatal("existing output changed")
	}
}

func TestStaticPackageRejectsLinks(t *testing.T) {
	manifest := skillManifest()
	source := writeSkillSource(t, manifest, []byte("# Original"))
	target := filepath.Join(filepath.Dir(source), filepath.FromSlash(manifest.Contributes.Skills[0].Entry))
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("# Outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, target); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if err := buildPackage(context.Background(), options{static: true, manifest: source, output: filepath.Join(t.TempDir(), "package")}); err == nil {
		t.Fatal("symlink Skill included")
	}
}

func TestNativePackageModeRemainsAvailableAndStaticIsExplicit(t *testing.T) {
	source := writeSkillSource(t, skillManifest(), []byte("# Valid"))
	if err := buildPackage(context.Background(), options{manifest: source, output: filepath.Join(t.TempDir(), "missing-mode")}); err == nil {
		t.Fatal("backend-free template silently changed native mode")
	}
	output := filepath.Join(t.TempDir(), "native")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := buildPackage(ctx, options{source: "../hello", manifest: "../hello/gonavi.plugin.json", output: output, goos: runtime.GOOS, goarch: runtime.GOARCH}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(output, "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	entry, exists := manifest.Backend.Platforms[runtime.GOOS+"/"+runtime.GOARCH]
	if !exists {
		t.Fatal("native platform entry missing")
	}
	if _, err = os.Stat(filepath.Join(output, filepath.FromSlash(entry.Executable))); err != nil {
		t.Fatal(err)
	}
}
