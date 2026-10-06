package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// newTestService 在临时目录打开一个服务，测试结束时关闭。
func newTestService(t *testing.T) *Service {
	t.Helper()
	service, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open service: %v", err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}

// enableCodex 建立一个已启用的 Codex 集成与一个来源，返回集成与来源 ID。
func enableCodex(t *testing.T, service *Service) (string, string) {
	t.Helper()
	integration, err := service.catalog.EnableIntegration(context.Background(), AgentKindCodex, "Codex")
	if err != nil {
		t.Fatalf("enable integration: %v", err)
	}
	source, err := service.catalog.UpsertSource(context.Background(), SourceInput{
		IntegrationID: integration.ID,
		Kind:          "cli",
		DisplayName:   "default",
		RootPath:      t.TempDir(),
		IdentityKey:   "identity-" + integration.ID,
	})
	if err != nil {
		t.Fatalf("upsert source: %v", err)
	}
	return integration.ID, source.ID
}

// seedAsset 纳入一个虚构资产。
func seedAsset(t *testing.T, service *Service, integrationID, sourceID, threadID string) Asset {
	t.Helper()
	asset, err := service.catalog.UpsertAsset(context.Background(), AssetInput{
		IntegrationID:  integrationID,
		NativeThreadID: threadID,
		SourceID:       sourceID,
		NativePath:     filepath.Join("archived_sessions", "rollout-"+threadID+".jsonl"),
		SourceStatus:   SourceStatusArchived,
		Title:          "fixture " + threadID,
	})
	if err != nil {
		t.Fatalf("upsert asset: %v", err)
	}
	return asset
}

// writeSourceFile 写入一个虚构来源文件并返回其路径。
func writeSourceFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write source file: %v", err)
	}
	return path
}

// enqueueSimpleCapture 入队一个单文件保全请求并返回任务。
func enqueueSimpleCapture(t *testing.T, service *Service, assetID, sourceID, sourcePath string) CaptureJob {
	t.Helper()
	job, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID:        assetID,
		SourceID:       sourceID,
		Trigger:        string(CaptureTriggerArchiveEvent),
		NativeThreadID: "thread-" + assetID,
		SourcePath:     sourcePath,
		Files: []MaterialFile{{
			RelPath:    "raw/rollout.jsonl",
			SourcePath: sourcePath,
			Role:       string(MaterialRolePrimary),
		}},
	})
	if err != nil {
		t.Fatalf("enqueue capture: %v", err)
	}
	return job
}

// runQueue 同步推进队列直到没有排队任务。
func runQueue(t *testing.T, service *Service) {
	t.Helper()
	for {
		processed, err := service.runWorkerOnce(context.Background())
		if errors.Is(err, ErrNotFound) {
			return
		}
		if err != nil {
			t.Fatalf("run worker once: %v", err)
		}
		if !processed {
			return
		}
	}
}

// mustReadPointer 读取 latest 指针，要求存在。
func mustReadPointer(t *testing.T, service *Service, assetID string) CurrentPointer {
	t.Helper()
	pointer, ok, err := readCurrentPointer(service.paths.AssetDir(assetID))
	if err != nil || !ok {
		t.Fatalf("read current pointer: ok=%v err=%v", ok, err)
	}
	return pointer
}

func TestEnableIntegrationIdempotent(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	first, err := service.catalog.EnableIntegration(ctx, AgentKindCodex, "Codex")
	if err != nil {
		t.Fatalf("first enable: %v", err)
	}
	second, err := service.catalog.EnableIntegration(ctx, AgentKindCodex, "Codex")
	if err != nil {
		t.Fatalf("second enable: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("duplicate integration created: %s vs %s", first.ID, second.ID)
	}
	list, err := service.catalog.ListIntegrations(ctx)
	if err != nil {
		t.Fatalf("list integrations: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 integration, got %d", len(list))
	}
}

func TestUpsertSourceDedupByIdentity(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, _ := enableCodex(t, service)
	first, err := service.catalog.UpsertSource(ctx, SourceInput{
		IntegrationID: integrationID, RootPath: `C:\history`, IdentityKey: "vol-1|c-history",
	})
	if err != nil {
		t.Fatalf("first source: %v", err)
	}
	alias, err := service.catalog.UpsertSource(ctx, SourceInput{
		IntegrationID: integrationID, RootPath: `C:\history`, IdentityKey: "vol-1|c-history", DisplayName: "alias",
	})
	if err != nil {
		t.Fatalf("aliased source: %v", err)
	}
	if first.ID != alias.ID {
		t.Fatalf("same directory registered twice: %s vs %s", first.ID, alias.ID)
	}
}

func TestUpsertAssetRefAndSuppression(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	first := seedAsset(t, service, integrationID, sourceID, "thread-1")
	second := seedAsset(t, service, integrationID, sourceID, "thread-1")
	if first.ID != second.ID {
		t.Fatalf("same thread created two assets: %s vs %s", first.ID, second.ID)
	}
	if err := service.DeleteAsset(ctx, first.ID); err != nil {
		t.Fatalf("delete asset: %v", err)
	}
	if _, err := service.catalog.UpsertAsset(ctx, AssetInput{
		IntegrationID: integrationID, NativeThreadID: "thread-1", SourceID: sourceID,
	}); !errors.Is(err, ErrSuppressed) {
		t.Fatalf("re-discovery after delete should be suppressed, got %v", err)
	}
	if _, err := service.catalog.GetAsset(ctx, first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted asset should be gone, got %v", err)
	}
}

// P0-06：跨来源相同 native_thread_id 保留独立资产，不无条件合并；
// 同来源身份仍幂等合并（V-01/V-06）。
func TestCrossSourceSameThreadStaysIndependent(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceAID := enableCodex(t, service)
	sourceA, err := service.catalog.GetSource(ctx, sourceAID)
	if err != nil {
		t.Fatalf("load source A: %v", err)
	}
	sourceB, err := service.catalog.UpsertSource(ctx, SourceInput{
		IntegrationID: integrationID,
		Kind:          "cli",
		DisplayName:   "second location",
		RootPath:      `D:\second`,
		IdentityKey:   "identity-second",
	})
	if err != nil {
		t.Fatalf("seed source B: %v", err)
	}
	inA := AssetInput{
		IntegrationID:     integrationID,
		NativeThreadID:    "thread-shared",
		SourceID:          sourceA.ID,
		OriginIdentityKey: sourceA.IdentityKey,
		SourceStatus:      SourceStatusArchived,
		Provider:          "openai",
	}
	inB := inA
	inB.SourceID = sourceB.ID
	inB.OriginIdentityKey = sourceB.IdentityKey
	inB.Provider = "relay"

	first, err := service.catalog.UpsertAsset(ctx, inA)
	if err != nil {
		t.Fatalf("upsert A: %v", err)
	}
	second, err := service.catalog.UpsertAsset(ctx, inB)
	if err != nil {
		t.Fatalf("upsert B: %v", err)
	}
	if first.ID == second.ID {
		t.Fatalf("different sources must keep independent assets")
	}
	if first.Provider != "openai" || second.Provider != "relay" {
		t.Fatalf("providers must not overwrite across sources: %q vs %q", first.Provider, second.Provider)
	}
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	if len(assets) != 2 {
		t.Fatalf("expected 2 assets, got %d", len(assets))
	}
}
