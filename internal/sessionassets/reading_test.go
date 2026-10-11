package sessionassets

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestListAssetsViewFilterAndPaging(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	first := seedAsset(t, service, integrationID, sourceID, "thread-list-1")
	second := seedAsset(t, service, integrationID, sourceID, "thread-list-2")
	_ = first
	_ = second
	// 更新标题与 provider 以便筛选命中。
	if _, err := service.catalog.UpsertAsset(ctx, AssetInput{
		IntegrationID: integrationID, NativeThreadID: "thread-list-1", SourceID: sourceID,
		SourceStatus: SourceStatusArchived, Title: "alpha migration", Provider: "openai",
	}); err != nil {
		t.Fatalf("reseed: %v", err)
	}
	if _, err := service.catalog.UpsertAsset(ctx, AssetInput{
		IntegrationID: integrationID, NativeThreadID: "thread-list-2", SourceID: sourceID,
		SourceStatus: SourceStatusArchived, Title: "beta cleanup", Provider: "relay",
	}); err != nil {
		t.Fatalf("reseed 2: %v", err)
	}

	views, total, err := service.ListAssetsView(ctx, integrationID, AssetFilter{Query: "migration", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 || len(views) != 1 || views[0].NativeThreadID != "thread-list-1" {
		t.Fatalf("query filter wrong: total=%d views=%+v", total, views)
	}
	views, total, err = service.ListAssetsView(ctx, integrationID, AssetFilter{Provider: "relay", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("list provider: %v", err)
	}
	if total != 1 || views[0].Provider != "relay" {
		t.Fatalf("provider filter wrong: total=%d", total)
	}
}

// syncArchivedAsset 是测试辅助：登记并保全一个归档会话。
func syncArchivedAsset(t *testing.T, service *Service, source Source, threadID string) (Asset, DiscoveredSession) {
	t.Helper()
	session := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), threadID, true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(context.Background(), source, discoverer.scanResult()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	runQueue(t, service)
	assets, _ := service.catalog.ListAssets(context.Background(), source.IntegrationID)
	for _, item := range assets {
		if item.NativeThreadID == threadID {
			return item, session
		}
	}
	t.Fatalf("asset %s not found after sync", threadID)
	return Asset{}, DiscoveredSession{}
}

func TestAssetDetailReadSourceTransitions(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	asset, session := syncArchivedAsset(t, service, source, "thread-detail")

	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail.ReadSource != ReadSourceLive || detail.ReadPath != session.NativePath {
		t.Fatalf("read source = %s (%s), want live", detail.ReadSource, detail.ReadPath)
	}

	// 移除原源：读源切换到备份并给出覆盖时间。
	if err := os.RemoveAll(source.RootPath); err != nil {
		t.Fatalf("remove source: %v", err)
	}
	if _, err := service.SyncSource(ctx, source, SourceScanResult{Quality: ScanQualityComplete, Complete: true}); err != nil {
		t.Fatalf("sync after removal: %v", err)
	}
	detail, err = service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail after removal: %v", err)
	}
	if detail.ReadSource != ReadSourceBackup || detail.ReadPath == "" {
		t.Fatalf("read source after removal = %s, want backup", detail.ReadSource)
	}
	if detail.CoverageAt <= 0 || !detail.LatestComplete {
		t.Fatalf("coverage must be reported: coverageAt=%d", detail.CoverageAt)
	}
	if detail.SourceStatus != string(SourceStatusDeleted) {
		t.Fatalf("source status = %s, want deleted", detail.SourceStatus)
	}
}

func TestAssetDetailMissingShowsNothingReadable(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-bare")
	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail.ReadSource != ReadSourceMissing || detail.HasReadableHistory() {
		t.Fatalf("bare asset must not offer readable history: %+v", detail)
	}
}

// 旧构建写出的清单可能缺 files/ancestors 等键：解码后是 nil slice，
// 序列化为 JSON null 会把前端材料页签读炸（用户实测整页崩溃）。
// AssetDetail 必须把它们归一为空数组。
func TestAssetDetailNormalizesNullCollections(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	asset, _ := syncArchivedAsset(t, service, source, "thread-null-collections")

	manifestPath := filepath.Join(service.paths.GenerationDir(asset.ID, asset.LatestGenerationID), manifestFileName)
	if err := os.WriteFile(manifestPath, []byte(`{"formatVersion":1,"generationId":"`+asset.LatestGenerationID+`","assetId":"`+asset.ID+`"}`), 0o600); err != nil {
		t.Fatalf("rewrite manifest: %v", err)
	}

	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail.MaterialFiles == nil || detail.Ancestors == nil || detail.Attachments == nil || detail.Missing == nil || detail.SourceRefs == nil || detail.Jobs == nil {
		t.Fatalf("detail collections must be non-nil after normalization: %+v", detail)
	}
	if len(detail.MaterialFiles) != 0 || len(detail.Ancestors) != 0 || len(detail.Attachments) != 0 || len(detail.Missing) != 0 {
		t.Fatalf("normalized collections must be empty: %+v", detail)
	}
}
