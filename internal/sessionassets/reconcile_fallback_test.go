package sessionassets

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestReconcileFallsBackToVerifiedGeneration 覆盖 P0-04：current 指向
// 被篡改的代次时，核对必须回退到另一个**完整可验证**的代次（多代次
// 共存的崩溃窗口：新代次提交后、旧代次清理前进程终止），且损坏代次
// 被清理、完好代次不被误删。
func TestReconcileFallsBackToVerifiedGeneration(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}

	// 第一代：正常提交（完好）。
	sessionDir := filepath.Join(source.RootPath, "archived_sessions")
	first := seedRealSession(t, sessionDir, "thread-fallback", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{first}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	runQueue(t, service)
	var asset Asset
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-fallback" {
			asset = item
		}
	}
	goodGen := mustReadPointer(t, service, asset.ID).GenerationID
	goodDir := service.paths.GenerationDir(asset.ID, goodGen)

	// 手工构造窗口：把完好代次复制为目录名更大（更新）的代次，篡改其
	// raw 内容，再删除 current——等价于新代次提交后、指针落盘前损坏。
	brokenGenDir := filepath.Join(service.paths.GenerationsDir(asset.ID), "9999999999999999999-broken00")
	if err := filepath.WalkDir(goodDir, func(path string, info os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(goodDir, path)
		if err != nil {
			return err
		}
		target := filepath.Join(brokenGenDir, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, payload, 0o600)
	}); err != nil {
		t.Fatalf("clone generation: %v", err)
	}
	brokenRaw := filepath.Join(brokenGenDir, "raw", "rollout.jsonl")
	if err := os.WriteFile(brokenRaw, []byte("tampered-content"), 0o600); err != nil {
		t.Fatalf("tamper clone: %v", err)
	}
	if err := os.Remove(service.paths.CurrentPath(asset.ID)); err != nil {
		t.Fatalf("remove current: %v", err)
	}

	// 核对：损坏的更新代次被跳过，完好的较旧代次被提升。
	if err := service.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	recovered := mustReadPointer(t, service, asset.ID)
	if recovered.GenerationID != goodGen {
		t.Fatalf("pointer = %s, want fallback to good generation %s", recovered.GenerationID, goodGen)
	}
	manifest, err := readManifestJSON(goodDir)
	if err != nil {
		t.Fatalf("good manifest must survive: %v", err)
	}
	if err := verifyGenerationFiles(goodDir, manifest); err != nil {
		t.Fatalf("good generation verification: %v", err)
	}
	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("reload asset: %v", err)
	}
	if updated.LatestGenerationID != goodGen || !updated.LatestComplete {
		t.Fatalf("projection must follow recovered generation: %+v", updated)
	}
	// 损坏代次被清理，完好代次保留。
	if _, err := os.Stat(filepath.Join(service.paths.GenerationsDir(asset.ID), "9999999999999999999-broken00")); !os.IsNotExist(err) {
		t.Fatalf("broken generation must be cleaned up")
	}
}

// TestReconcileRejectsCorruptUnpointedGeneration 覆盖 P0-04：指针缺失且
// 仅存损坏代次时，不得提升损坏材料，投影回退为无副本。
func TestReconcileRejectsCorruptUnpointedGeneration(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	session := seedRealSession(t, filepath.Join(source.RootPath, "archived_sessions"), "thread-corrupt-only", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{session}}
	if _, err := service.SyncSource(ctx, source, discoverer.scanResult()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	runQueue(t, service)
	var asset Asset
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-corrupt-only" {
			asset = item
		}
	}
	pointer := mustReadPointer(t, service, asset.ID)
	genDir := service.paths.GenerationDir(asset.ID, pointer.GenerationID)

	// 删除指针制造"未落指针"场景，再篡改唯一代次的文件。
	if err := os.Remove(service.paths.CurrentPath(asset.ID)); err != nil {
		t.Fatalf("remove pointer: %v", err)
	}
	rollout := filepath.Join(genDir, "raw", "rollout.jsonl")
	if err := os.WriteFile(rollout, []byte("corrupted-content"), 0o600); err != nil {
		t.Fatalf("corrupt: %v", err)
	}

	if err := service.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if _, ok, err := readCurrentPointer(service.paths.AssetDir(asset.ID)); ok || err != nil {
		t.Fatalf("corrupt-only generation must not be promoted, ok=%v err=%v", ok, err)
	}
	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("load asset: %v", err)
	}
	if updated.LatestGenerationID != "" {
		t.Fatalf("projection must be reset to none, got %s", updated.LatestGenerationID)
	}
}
