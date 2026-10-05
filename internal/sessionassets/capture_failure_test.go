package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaptureFailsWhenSourceMissingKeepsLatest(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-src-gone")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)
	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	baseline := mustReadPointer(t, service, asset.ID)

	if err := os.Remove(sourcePath); err != nil {
		t.Fatalf("remove source: %v", err)
	}
	job := enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)

	final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusFailed) {
		t.Fatalf("job status = %s, want failed", final.Status)
	}
	if got := mustReadPointer(t, service, asset.ID); got.GenerationID != baseline.GenerationID {
		t.Fatalf("latest pointer changed after failure: %s -> %s", baseline.GenerationID, got.GenerationID)
	}
}

func TestCaptureRejectsSourceChanged(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-src-changed")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)

	job, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-src-changed",
		SourcePath: sourcePath, SourceSize: 999,
		Files: []MaterialFile{{
			RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary), ExpectedSize: 999,
		}},
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	runQueue(t, service)

	final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusFailed) || !strings.Contains(final.Error, "changed") {
		t.Fatalf("job status=%s error=%s, want failed with source-changed reason", final.Status, final.Error)
	}
	if _, ok, err := readCurrentPointer(service.paths.AssetDir(asset.ID)); ok || err != nil {
		t.Fatalf("no pointer expected, ok=%v err=%v", ok, err)
	}
}

// stageCandidateWithJob 构造一个完整暂存候选（清单+文件+任务行），用于
// 模拟"完整未提交"与"候选损坏"两类切点。
func stageCandidateWithJob(t *testing.T, service *Service, assetID, sourceID, sourcePath, content string) CaptureJob {
	t.Helper()
	job, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: assetID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-stage",
		SourcePath: sourcePath,
		Files: []MaterialFile{{
			RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary),
		}},
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	stagingDir := service.paths.StagingPath(job.ID)
	if err := ensureDir(stagingDir); err != nil {
		t.Fatalf("stage dir: %v", err)
	}
	record, err := copyMaterialFile("raw/rollout.jsonl", sourcePath, stagingDir, 0)
	if err != nil {
		t.Fatalf("stage copy: %v", err)
	}
	record.Role = MaterialRolePrimary
	manifest := MaterialManifest{
		FormatVersion: manifestFormatVersion, AssetID: assetID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), Complete: true,
		CapturedAt: 1, Files: []MaterialFileRecord{record},
	}
	if _, err := writeManifestJSON(stagingDir, manifest); err != nil {
		t.Fatalf("stage manifest: %v", err)
	}
	return job
}

func TestReconcileResumesCompleteStagedCandidate(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-stage")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":"staged"}`)

	job := stageCandidateWithJob(t, service, asset.ID, sourceID, sourcePath, `{"rev":"staged"}`)
	if err := service.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusCommitted) {
		t.Fatalf("job status = %s, want committed via resume", final.Status)
	}
	pointer := mustReadPointer(t, service, asset.ID)
	manifest, err := readManifestJSON(service.paths.GenerationDir(asset.ID, pointer.GenerationID))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if err := verifyGenerationFiles(service.paths.GenerationDir(asset.ID, pointer.GenerationID), manifest); err != nil {
		t.Fatalf("resumed generation failed verification: %v", err)
	}
	if _, err := os.Stat(service.paths.StagingPath(job.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staging not cleaned after resume: %v", err)
	}
}

func TestReconcileAbandonsIncompleteAndCorruptCandidates(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-stage")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":"half"}`)

	// 切点一：半写终止，无清单。
	halfJob, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID, Trigger: string(CaptureTriggerArchiveEvent),
		NativeThreadID: "thread-stage", SourcePath: sourcePath,
		Files: []MaterialFile{{RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary)}},
	})
	if err != nil {
		t.Fatalf("enqueue half: %v", err)
	}
	halfDir := service.paths.StagingPath(halfJob.ID)
	if err := ensureDir(halfDir); err != nil {
		t.Fatalf("stage dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(halfDir, "raw"), []byte(`{"rev":"half`), 0o600); err != nil {
		t.Fatalf("write partial: %v", err)
	}

	// 切点二：清单完整但文件被篡改（损坏候选）。
	corruptJob := stageCandidateWithJob(t, service, asset.ID, sourceID, sourcePath, `{"rev":"staged"}`)
	corruptPath := filepath.Join(service.paths.StagingPath(corruptJob.ID), "raw", "rollout.jsonl")
	if err := os.WriteFile(corruptPath, []byte(`{"rev":"tampered"}`), 0o600); err != nil {
		t.Fatalf("tamper: %v", err)
	}

	if err := service.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	for name, job := range map[string]CaptureJob{"half": halfJob, "corrupt": corruptJob} {
		final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
		if err != nil {
			t.Fatalf("load %s job: %v", name, err)
		}
		if final.Status != string(CaptureStatusFailed) {
			t.Fatalf("%s job status = %s, want failed", name, final.Status)
		}
		if _, err := os.Stat(service.paths.StagingPath(job.ID)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s staging not cleaned: %v", name, err)
		}
	}
	if _, ok, err := readCurrentPointer(service.paths.AssetDir(asset.ID)); ok || err != nil {
		t.Fatalf("corrupt candidates must not commit, ok=%v err=%v", ok, err)
	}
}

func TestReconcileRecoversCommittedGenerationWithoutPointer(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-nopointer")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":"crash"}`)

	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	pointer := mustReadPointer(t, service, asset.ID)

	// 模拟指针写回前崩溃：删除 current.json 与索引投影。
	if err := os.Remove(service.paths.CurrentPath(asset.ID)); err != nil {
		t.Fatalf("remove pointer: %v", err)
	}
	if err := service.catalog.UpdateAssetProjection(context.Background(), asset.ID, BackupStatusNone, MaterialStatusNotPrepared, "", false, 0); err != nil {
		t.Fatalf("reset projection: %v", err)
	}

	if err := service.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	recovered := mustReadPointer(t, service, asset.ID)
	if recovered.GenerationID != pointer.GenerationID {
		t.Fatalf("recovered generation %s, want %s", recovered.GenerationID, pointer.GenerationID)
	}
	updated, err := service.catalog.GetAsset(context.Background(), asset.ID)
	if err != nil {
		t.Fatalf("load asset: %v", err)
	}
	if updated.LatestGenerationID != pointer.GenerationID || !updated.LatestComplete {
		t.Fatalf("projection not repaired: %+v", updated)
	}
}

func TestReconcileRepairsProjectionDrift(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-drift")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":"drift"}`)

	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	pointer := mustReadPointer(t, service, asset.ID)

	// 模拟指针提交成功但索引更新被打断。
	if err := service.catalog.UpdateAssetProjection(context.Background(), asset.ID, BackupStatusNone, MaterialStatusNotPrepared, "", false, 0); err != nil {
		t.Fatalf("corrupt projection: %v", err)
	}
	if err := service.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	updated, err := service.catalog.GetAsset(context.Background(), asset.ID)
	if err != nil {
		t.Fatalf("load asset: %v", err)
	}
	if updated.LatestGenerationID != pointer.GenerationID || updated.BackupStatus != string(BackupStatusVerified) {
		t.Fatalf("projection drift not repaired: %+v", updated)
	}
}

func TestLibrarySingleWriter(t *testing.T) {
	root := t.TempDir()
	first, err := Open(root)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	t.Cleanup(func() { _ = first.Close() })
	second, err := Open(root)
	if !errors.Is(err, ErrLibraryLocked) {
		t.Fatalf("second open error = %v, want ErrLibraryLocked", err)
	}
	if second != nil {
		_ = second.Close()
		t.Fatalf("second open must not return a service")
	}
}

func TestDeleteParentKeepsChildSelfContained(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	parent := seedAsset(t, service, integrationID, sourceID, "thread-parent")
	child, err := service.catalog.UpsertAsset(context.Background(), AssetInput{
		IntegrationID: integrationID, NativeThreadID: "thread-child", SourceID: sourceID,
		ForkParentThreadID: "thread-parent",
	})
	if err != nil {
		t.Fatalf("seed child: %v", err)
	}
	for name, asset := range map[string]Asset{"parent": parent, "child": child} {
		sourcePath := writeSourceFile(t, t.TempDir(), name+".jsonl", `{"asset":"`+name+`"}`)
		enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	}
	runQueue(t, service)

	if err := service.DeleteAsset(context.Background(), parent.ID); err != nil {
		t.Fatalf("delete parent: %v", err)
	}
	if _, err := os.Stat(service.paths.AssetDir(parent.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("parent materials not removed: %v", err)
	}
	childPointer := mustReadPointer(t, service, child.ID)
	manifest, err := readManifestJSON(service.paths.GenerationDir(child.ID, childPointer.GenerationID))
	if err != nil {
		t.Fatalf("read child manifest: %v", err)
	}
	if err := verifyGenerationFiles(service.paths.GenerationDir(child.ID, childPointer.GenerationID), manifest); err != nil {
		t.Fatalf("child material must stay valid: %v", err)
	}
}

func TestQueuedJobCancelledByDelete(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-delete-race")
	sourcePath := writeSourceFile(t, t.TempDir(), "rollout.jsonl", `{"rev":"race"}`)

	job := enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	if err := service.DeleteAsset(context.Background(), asset.ID); err != nil {
		t.Fatalf("delete asset: %v", err)
	}
	runQueue(t, service)

	// 任务历史随资产清理级联删除：用户删除后不保留该资产的任务记录。
	if _, err := service.catalog.GetCaptureJob(context.Background(), job.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("job row should be purged with the asset, got %v", err)
	}
	if _, ok, err := readCurrentPointer(service.paths.AssetDir(asset.ID)); ok || err != nil {
		t.Fatalf("deleted asset must not gain a pointer, ok=%v err=%v", ok, err)
	}
	if _, err := os.Stat(service.paths.AssetDir(asset.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted asset materials not removed: %v", err)
	}
	if _, err := service.catalog.UpsertAsset(context.Background(), AssetInput{
		IntegrationID: integrationID, NativeThreadID: "thread-delete-race", SourceID: sourceID,
	}); !errors.Is(err, ErrSuppressed) {
		t.Fatalf("re-discovery after delete must stay suppressed, got %v", err)
	}
}

func TestGenerationConflictRejectsStaleTask(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-conflict")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)

	// 两个任务都在无 latest 时入队（base 为空），串行执行后第二个
	// 必须因代次冲突被拒绝，不得覆盖第一个的提交结果。
	first := enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	second, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-conflict",
		SourcePath: sourcePath,
		Files:      []MaterialFile{{RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary)}},
	})
	if err != nil {
		t.Fatalf("enqueue second: %v", err)
	}
	runQueue(t, service)

	firstFinal, err := service.catalog.GetCaptureJob(context.Background(), first.ID)
	if err != nil {
		t.Fatalf("load first job: %v", err)
	}
	secondFinal, err := service.catalog.GetCaptureJob(context.Background(), second.ID)
	if err != nil {
		t.Fatalf("load second job: %v", err)
	}
	if firstFinal.Status != string(CaptureStatusCommitted) {
		t.Fatalf("first job status = %s, want committed", firstFinal.Status)
	}
	if secondFinal.Status != string(CaptureStatusFailed) || !strings.Contains(secondFinal.Error, "conflict") {
		t.Fatalf("second job status=%s error=%s, want failed with conflict", secondFinal.Status, secondFinal.Error)
	}
	pointer := mustReadPointer(t, service, asset.ID)
	if pointer.GenerationID != firstFinal.GenerationID {
		t.Fatalf("stale task overwrote latest: %s vs %s", pointer.GenerationID, firstFinal.GenerationID)
	}
}
