package sessionassets

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDisableIntegrationStopsObservationAndRejectsNewWork(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	archiveDir := filepath.Join(source.RootPath, "archived_sessions")
	if err := os.MkdirAll(archiveDir, 0o700); err != nil {
		t.Fatalf("mkdir archive: %v", err)
	}
	discoverer := &fakeDiscoverer{single: map[string]DiscoveredSession{}}
	if err := service.StartSourceObservation(source, discoverer, nil); err != nil {
		t.Fatalf("start observation: %v", err)
	}

	// 禁用：观察器停止、排队任务取消。
	stopped := service.StopIntegrationObservation(source.IntegrationID)
	if len(stopped) == 0 {
		t.Fatalf("no observer stopped for integration")
	}
	cancelled, err := service.catalog.CancelQueuedJobsForIntegration(ctx, source.IntegrationID)
	if err != nil || cancelled != 0 {
		t.Fatalf("cancel queued: %d %v", cancelled, err)
	}
	if running := service.ObserversRunning(); len(running) != 0 {
		t.Fatalf("observers still running: %v", running)
	}
}

func TestDisableRejectsNewCaptureEnqueue(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-disable")
	sourcePath := writeSourceFile(t, t.TempDir(), "rollout.jsonl", `{"rev":1}`)

	// 先禁用，再尝试入队：必须被拒绝（FR-28）。
	if err := service.catalog.SetIntegrationEnabled(ctx, integrationID, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	_, err := service.EnqueueCapture(ctx, CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerManualRetry), NativeThreadID: "thread-disable",
		SourcePath: sourcePath,
		Files:      []MaterialFile{{RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary)}},
	})
	if err == nil {
		t.Fatalf("enqueue must be rejected while integration disabled")
	}
}

func TestDisableBeforeCommitKeepsOldLatest(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), "thread-disable-commit", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.sessions, true); err != nil {
		t.Fatalf("initial sync: %v", err)
	}
	runQueue(t, service)
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	asset := assets[0]
	baseline := mustReadPointer(t, service, asset.ID)

	// 重归档事件已入队，但提交落点前集成被禁用：不得写入新结果。
	if _, err := service.SyncSource(ctx, source, nil, true); err != nil {
		t.Fatalf("resync: %v", err)
	}
	reArchived := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), "thread-disable-commit", true)
	reArchived.ModifiedAt++ // 模拟源变化触发重新保全
	discoverer.sessions = []DiscoveredSession{reArchived}
	if _, err := service.SyncSource(ctx, source, discoverer.sessions, true); err != nil {
		t.Fatalf("re-archive sync: %v", err)
	}
	if err := service.catalog.SetIntegrationEnabled(ctx, integrationID, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	runQueue(t, service)

	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("reload asset: %v", err)
	}
	if got := mustReadPointer(t, service, asset.ID); got.GenerationID != baseline.GenerationID {
		t.Fatalf("disabled integration must not commit new generations")
	}
	if updated.BackupStatus != string(BackupStatusVerified) {
		t.Fatalf("projection should keep verified latest: %+v", updated)
	}
}

func TestDisableDropsArchiveEvents(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	archiveDir := filepath.Join(source.RootPath, "archived_sessions")
	if err := os.MkdirAll(archiveDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	realSession := seedRealSession(t, archiveDir, "thread-disable-evt", true)
	discoverer := &fakeDiscoverer{single: map[string]DiscoveredSession{realSession.NativePath: realSession}}
	if err := service.StartSourceObservation(source, discoverer, nil); err != nil {
		t.Fatalf("start observation: %v", err)
	}

	// 禁用后归档事件到达：处理器必须丢弃（不纳入、不入队）。
	if err := service.catalog.SetIntegrationEnabled(ctx, integrationID, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := os.WriteFile(realSession.NativePath, []byte(`{"type":"session_meta"}`), 0o600); err != nil {
		t.Fatalf("rewrite rollout: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		assets, _ := service.catalog.ListAssets(ctx, integrationID)
		if len(assets) > 0 {
			t.Fatalf("disabled integration must not index archive events")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
