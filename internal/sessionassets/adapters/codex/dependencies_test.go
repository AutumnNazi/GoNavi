package codex

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/sessionassets"
)

// P0-05：rollout 引用的祖先文件缺失时，依赖解析产生 Missing。
func TestResolveDependenciesMarksMissingAncestor(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "archived_sessions")
	if err := os.MkdirAll(archive, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	main := filepath.Join(archive, "rollout-main.jsonl")
	base := `{"timestamp":"t","type":"session_meta","payload":{"session_id":"th-main"}}` + "\n"
	withRef := base + `{"timestamp":"t","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"fork from rollout-2026-01-01T00-00-00-00000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"}]}}` + "\n"
	if err := os.WriteFile(main, []byte(withRef), 0o600); err != nil {
		t.Fatalf("write main: %v", err)
	}
	resolution, err := (Discoverer{}).ResolveDependencies(context.Background(), dir, main)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	found := false
	for _, missing := range resolution.Missing {
		if missing.Reason == string(sessionassets.MissingAncestor) {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing ancestor not recorded: %+v", resolution)
	}
}

// P0-05：祖先文件存在时解析为 Ancestors 且源文件可读。
func TestResolveDependenciesCopiesPresentAncestor(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "archived_sessions")
	if err := os.MkdirAll(archive, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.MkdirAll(archive, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	ancestorName := "rollout-2026-01-01T00-00-00-00000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"
	if err := os.WriteFile(filepath.Join(archive, ancestorName), []byte(`{"ancestor":true}`), 0o600); err != nil {
		t.Fatalf("write ancestor: %v", err)
	}
	main := filepath.Join(archive, "rollout-main.jsonl")
	base := `{"timestamp":"t","type":"session_meta","payload":{"session_id":"th-main"}}` + "\n"
	withRef := base + `{"timestamp":"t","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"fork from ` + ancestorName + `"}]}}` + "\n"
	if err := os.WriteFile(main, []byte(withRef), 0o600); err != nil {
		t.Fatalf("write main: %v", err)
	}
	resolution, err := (Discoverer{}).ResolveDependencies(context.Background(), dir, main)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(resolution.Missing) != 0 {
		t.Fatalf("present ancestor must not be missing: %+v", resolution.Missing)
	}
	if len(resolution.Ancestors) == 0 || len(resolution.Ancestors[0].Files) == 0 {
		t.Fatalf("present ancestor must resolve: %+v", resolution.Ancestors)
	}
	for _, ancestor := range resolution.Ancestors {
		for _, file := range ancestor.Files {
			if _, err := os.Stat(file.SourcePath); err != nil {
				t.Fatalf("ancestor source file missing: %v", err)
			}
		}
	}
}

// 无引用的 rollout 保持自包含：无祖先、无缺失。
func TestResolveDependenciesSelfContained(t *testing.T) {
	dir := t.TempDir()
	main := filepath.Join(dir, "rollout-solo.jsonl")
	if err := os.WriteFile(main, []byte(`{"timestamp":"t","type":"session_meta","payload":{"session_id":"th-solo"}}`+"\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	resolution, err := (Discoverer{}).ResolveDependencies(context.Background(), dir, main)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(resolution.Ancestors) != 0 || len(resolution.Missing) != 0 {
		t.Fatalf("self-contained rollout must resolve empty: %+v", resolution)
	}
}
