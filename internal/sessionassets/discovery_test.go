package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeDiscoverer 是来源发现的虚构实现。
type fakeDiscoverer struct {
	sessions []DiscoveredSession
	single   map[string]DiscoveredSession
	failScan bool
	quality  string // 缺省 complete
}

func (f *fakeDiscoverer) scanResult() SourceScanResult {
	quality := f.quality
	if quality == "" {
		quality = ScanQualityComplete
	}
	if f.failScan {
		return SourceScanResult{Quality: ScanQualityUnreachable, Unreachable: true}
	}
	return SourceScanResult{
		Sessions: f.sessions,
		Broken:   make([]string, 0),
		Quality:  quality,
		Complete: quality == ScanQualityComplete,
	}
}

func (f *fakeDiscoverer) DiscoverSourceSessions(_ context.Context, _ string) (SourceScanResult, error) {
	if f.failScan {
		return SourceScanResult{Quality: ScanQualityUnreachable, Unreachable: true}, errors.New("scan failed")
	}
	return f.scanResult(), nil
}

func (f *fakeDiscoverer) DiscoverSession(_ context.Context, path string, archived bool) (DiscoveredSession, error) {
	if session, ok := f.single[path]; ok {
		session.Archived = archived
		return session, nil
	}
	return DiscoveredSession{}, errors.New("unknown session file")
}

func seedDiscovered(threadID, path string, archived bool) DiscoveredSession {
	return DiscoveredSession{
		NativeThreadID: threadID,
		NativePath:     path,
		Archived:       archived,
		ProjectDir:     `C:\work\demo`,
		Provider:       "openai",
		ModifiedAt:     time.Now().Unix(),
		Size:           128,
	}
}

// seedRealSession 写入一个真实存在的虚构 rollout 文件，返回其发现结果。
func seedRealSession(t *testing.T, dir, threadID string, archived bool) DiscoveredSession {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir session dir: %v", err)
	}
	name := "rollout-" + threadID + ".jsonl"
	path := filepath.Join(dir, name)
	content := []byte(`{"type":"session_meta","payload":{"session_id":"` + threadID + `"}}` + "\n")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat rollout: %v", err)
	}
	return DiscoveredSession{
		NativeThreadID: threadID,
		NativePath:     path,
		Archived:       archived,
		ProjectDir:     `C:\work\demo`,
		Provider:       "openai",
		ModifiedAt:     info.ModTime().Unix(),
		Size:           info.Size(),
	}
}

func TestSyncSourceBackfillsArchivedSessions(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	root := t.TempDir()
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{
		seedRealSession(t, filepath.Join(root, "archived_sessions"), "thread-archived", true),
		seedRealSession(t, filepath.Join(root, "sessions"), "thread-active", false),
	}}
	report, err := service.SyncSource(ctx, source, discoverer.scanResult())
	if err != nil {
		t.Fatalf("sync source: %v", err)
	}
	if report.Discovered != 2 || report.Backfilled != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	asset, err := service.catalog.GetAsset(ctx, func() string {
		assets, _ := service.catalog.ListAssets(ctx, integrationID)
		for _, item := range assets {
			if item.NativeThreadID == "thread-archived" {
				return item.ID
			}
		}
		return ""
	}())
	if err != nil {
		t.Fatalf("load archived asset: %v", err)
	}
	jobs, err := service.catalog.ListCaptureJobs(ctx, asset.ID)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("expected one queued backfill job, got %d (%v)", len(jobs), err)
	}
	// 完成队列后 latest 生效。
	runQueue(t, service)
	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("reload asset: %v", err)
	}
	if updated.LatestGenerationID == "" || updated.BackupStatus != string(BackupStatusVerified) {
		t.Fatalf("backfill did not commit: %+v", updated)
	}
}

func TestSyncSourceDoesNotDuplicateJobs(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedDiscovered("thread-dup", `X:\archived\rollout-dup.jsonl`, true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	assets, err := service.catalog.ListAssets(ctx, source.IntegrationID)
	if err != nil || len(assets) != 1 {
		t.Fatalf("expected single asset, got %d (%v)", len(assets), err)
	}
	jobs, err := service.catalog.ListCaptureJobs(ctx, assets[0].ID)
	if err != nil {
		t.Fatalf("list jobs: %v", err)
	}
	queued := 0
	for _, job := range jobs {
		if job.Status == string(CaptureStatusQueued) || job.Status == string(CaptureStatusRunning) {
			queued++
		}
	}
	if queued != 1 {
		t.Fatalf("expected exactly one active job, got %d", queued)
	}
}

func TestSyncSourceMarksGoneOnlyAfterFullScan(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	first := seedDiscovered("thread-gone", `X:\archived\rollout-gone.jsonl`, true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{first}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("seed sync: %v", err)
	}
	assetID := ""
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-gone" {
			assetID = item.ID
		}
	}

	// 扫描失败：不得把消失的引用标为删除（V-22）。
	discoverer.failScan = true
	if _, err := service.SyncSource(ctx, source, SourceScanResult{Quality: ScanQualityPartial}); err != nil {
		t.Fatalf("failed scan should not error at sync level: %v", err)
	}
	refs, _ := service.catalog.ListSourceRefs(ctx, assetID)
	if refs[0].SourceStatus == string(SourceStatusDeleted) {
		t.Fatalf("unreachable scan must not mark deleted")
	}

	// 扫描完整成功但会话不再出现：标记明确删除（元数据维度）。
	discoverer.failScan = false
	discoverer.sessions = nil
	report, err := service.SyncSource(ctx, source, SourceScanResult{Quality: ScanQualityComplete, Complete: true})
	if err != nil {
		t.Fatalf("clean sync: %v", err)
	}
	if len(report.MarkedGone) != 1 {
		t.Fatalf("expected one gone marker, got %+v", report)
	}
	refs, _ = service.catalog.ListSourceRefs(ctx, assetID)
	if refs[0].SourceStatus != string(SourceStatusDeleted) {
		t.Fatalf("ref status = %s, want deleted", refs[0].SourceStatus)
	}
	// 资产与副本不受影响。
	if _, err := service.catalog.GetAsset(ctx, assetID); err != nil {
		t.Fatalf("asset must survive source disappearance: %v", err)
	}
}

func TestSyncSourceSkipsSuppressed(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedDiscovered("thread-killed", `X:\archived\rollout-killed.jsonl`, true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-killed" {
			if err := service.DeleteAsset(ctx, item.ID); err != nil {
				t.Fatalf("delete: %v", err)
			}
		}
	}
	// 重新扫描：被抑制的身份不重新纳入、不报错。
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("rescan after delete: %v", err)
	}
	list, _ := service.catalog.ListAssets(ctx, integrationID)
	if len(list) != 0 {
		t.Fatalf("suppressed identity resurfaced: %d", len(list))
	}
}

func TestArchiveEventObservationTriggersBackfill(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	// 构造与来源根对应的虚构 Codex 目录。
	archiveDir := filepath.Join(source.RootPath, "archived_sessions")
	if err := os.MkdirAll(archiveDir, 0o700); err != nil {
		t.Fatalf("mkdir archive: %v", err)
	}
	realSession := seedRealSession(t, archiveDir, "thread-observed", true)
	discoverer := &fakeDiscoverer{single: map[string]DiscoveredSession{
		realSession.NativePath: realSession,
	}}
	if err := service.StartSourceObservation(source, discoverer, nil); err != nil {
		t.Fatalf("start observation: %v", err)
	}
	defer service.StopSourceObservation(source.ID)
	if running := service.ObserversRunning(); len(running) != 1 {
		t.Fatalf("observer not registered: %v", running)
	}

	// 归档目录出现新 rollout：安静窗口后应产生保全任务。
	if err := os.WriteFile(realSession.NativePath, []byte(`{"type":"session_meta"}`), 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		assets, _ := service.catalog.ListAssets(ctx, source.IntegrationID)
		if len(assets) == 1 {
			jobs, _ := service.catalog.ListCaptureJobs(ctx, assets[0].ID)
			if len(jobs) == 1 {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("archive event did not produce asset+job within deadline")
}

// TestM3CheckpointArchivePreserveThenSourceRemoved 是 M3 检查点：
// 启用 → 发现 → 归档事件 → 保全提交 → 移除隔离原源 → 仅凭副本核对
// hash/范围/源状态。
func TestM3CheckpointArchivePreserveThenSourceRemoved(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	archiveDir := filepath.Join(source.RootPath, "archived_sessions")
	session := seedRealSession(t, archiveDir, "thread-checkpoint", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}

	// 1) 发现并补保存。
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	runQueue(t, service)
	var asset Asset
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-checkpoint" {
			asset = item
		}
	}
	if asset.ID == "" || asset.LatestGenerationID == "" {
		t.Fatalf("checkpoint asset not committed: %+v", asset)
	}
	if refs, _ := service.catalog.ListSourceRefs(ctx, asset.ID); refs[0].SourceStatus != string(SourceStatusArchived) {
		t.Fatalf("ref status = %s, want archived", refs[0].SourceStatus)
	}

	// 2) 提交副本与源文件逐字节一致（hash 已在提交时校验）。
	committed, err := os.ReadFile(filepath.Join(service.paths.GenerationDir(asset.ID, asset.LatestGenerationID), "raw", "rollout.jsonl"))
	if err != nil {
		t.Fatalf("read committed copy: %v", err)
	}
	original, err := os.ReadFile(session.NativePath)
	if err != nil {
		t.Fatalf("read original: %v", err)
	}
	if string(committed) != string(original) {
		t.Fatalf("committed copy differs from original")
	}

	// 3) 移除隔离原源，标记明确删除。
	if err := os.RemoveAll(source.RootPath); err != nil {
		t.Fatalf("remove source root: %v", err)
	}
	if _, err := service.SyncSource(ctx, source, SourceScanResult{Quality: ScanQualityComplete, Complete: true}); err != nil {
		t.Fatalf("sync after removal: %v", err)
	}
	if refs, _ := service.catalog.ListSourceRefs(ctx, asset.ID); refs[0].SourceStatus != string(SourceStatusDeleted) {
		t.Fatalf("ref status after removal = %s, want deleted", refs[0].SourceStatus)
	}

	// 4) 仅凭副本核对：清单完整、文件可验证。
	manifest, err := readManifestJSON(service.paths.GenerationDir(asset.ID, asset.LatestGenerationID))
	if err != nil {
		t.Fatalf("read manifest without source: %v", err)
	}
	if !manifest.Complete || manifest.Source.Path != session.NativePath {
		t.Fatalf("manifest coverage wrong: %+v", manifest)
	}
	if err := verifyGenerationFiles(service.paths.GenerationDir(asset.ID, asset.LatestGenerationID), manifest); err != nil {
		t.Fatalf("standalone copy verification failed: %v", err)
	}
	updated, _ := service.catalog.GetAsset(ctx, asset.ID)
	if updated.BackupStatus != string(BackupStatusVerified) || !updated.LatestComplete {
		t.Fatalf("asset projection must stay verified after source removal: %+v", updated)
	}
}

func TestSyncSourceUnreachableMarksRefsNotDeleted(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), "thread-unreachable", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("initial sync: %v", err)
	}
	var assetID string
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-unreachable" {
			assetID = item.ID
		}
	}

	// 来源整体不可达（挂载丢失/权限变化）：引用改标不可达，不做删除推断。
	unreachable := SourceScanResult{Quality: ScanQualityUnreachable, Unreachable: true}
	if _, err := service.SyncSource(ctx, source, unreachable); err != nil {
		t.Fatalf("unreachable sync: %v", err)
	}
	refs, _ := service.catalog.ListSourceRefs(ctx, assetID)
	if refs[0].SourceStatus != string(SourceStatusUnreachable) {
		t.Fatalf("ref status = %s, want unreachable", refs[0].SourceStatus)
	}
	// 资产与副本不受影响。
	if _, err := service.catalog.GetAsset(ctx, assetID); err != nil {
		t.Fatalf("asset must survive unreachable: %v", err)
	}
}

func TestSyncSourcePartialDoesNotInferDeletion(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), "thread-partial-scan", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("initial sync: %v", err)
	}
	var assetID string
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-partial-scan" {
			assetID = item.ID
		}
	}

	// 部分扫描（如活跃目录权限错误）：不推断删除。
	partial := SourceScanResult{Quality: ScanQualityPartial}
	if _, err := service.SyncSource(ctx, source, partial); err != nil {
		t.Fatalf("partial sync: %v", err)
	}
	refs, _ := service.catalog.ListSourceRefs(ctx, assetID)
	if refs[0].SourceStatus == string(SourceStatusDeleted) {
		t.Fatalf("partial scan must not mark deleted")
	}
}


