package app

import (
	"context"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/sessionassets"
)

// 材料库被占用（服务未打开）时，集成列表降级为只读连接：分组照常显示，
// 摘要带 libraryLocked 标记，不再静默返回空列表。
func TestSessionAssetsListIntegrationsDegradesToReadOnly(t *testing.T) {
	root := t.TempDir()
	materialsRoot := filepath.Join(root, "session-assets")
	service, err := sessionassets.Open(materialsRoot)
	if err != nil {
		t.Fatalf("open materials library: %v", err)
	}
	integration, err := service.Catalog().EnableIntegration(context.Background(), sessionassets.AgentKindCodex, "Codex")
	if err != nil {
		t.Fatalf("enable integration: %v", err)
	}
	source, err := service.Catalog().UpsertSource(context.Background(), sessionassets.SourceInput{
		IntegrationID: integration.ID,
		Kind:          "cli",
		DisplayName:   "default",
		RootPath:      t.TempDir(),
		IdentityKey:   "identity-degraded",
	})
	if err != nil {
		t.Fatalf("upsert source: %v", err)
	}
	if _, err := service.Catalog().UpsertAsset(context.Background(), sessionassets.AssetInput{
		IntegrationID:  integration.ID,
		NativeThreadID: "thread-degraded-1",
		SourceID:       source.ID,
		NativePath:     filepath.Join("archived_sessions", "rollout-thread-degraded-1.jsonl"),
		SourceStatus:   sessionassets.SourceStatusArchived,
		Title:          "fixture degraded",
	}); err != nil {
		t.Fatalf("upsert asset: %v", err)
	}
	if err := service.Close(); err != nil {
		t.Fatalf("close materials library: %v", err)
	}

	t.Setenv("GONAVI_DATA_ROOT", root)
	a := NewApp()
	result := a.SessionAssetsListIntegrations()
	if !result.Success {
		t.Fatalf("degraded listing must succeed, got: %s", result.Message)
	}
	summaries, ok := result.Data.([]sessionassets.AgentIntegrationSummary)
	if !ok || len(summaries) != 1 {
		t.Fatalf("expected one summary, got %+v", result.Data)
	}
	summary := summaries[0]
	if summary.IntegrationID != integration.ID || summary.AssetCount != 1 {
		t.Fatalf("unexpected summary content: %+v", summary)
	}
	if !summary.LibraryLocked {
		t.Fatal("degraded summary must flag libraryLocked")
	}
}

// 从未启用过（无目录文件）时保持空列表语义，不报错、不降级。
func TestSessionAssetsListIntegrationsEmptyWithoutLibrary(t *testing.T) {
	t.Setenv("GONAVI_DATA_ROOT", t.TempDir())
	a := NewApp()
	result := a.SessionAssetsListIntegrations()
	if !result.Success {
		t.Fatalf("empty listing must succeed, got: %s", result.Message)
	}
	summaries, ok := result.Data.([]sessionassets.AgentIntegrationSummary)
	if !ok || len(summaries) != 0 {
		t.Fatalf("expected empty summaries, got %+v", result.Data)
	}
}
