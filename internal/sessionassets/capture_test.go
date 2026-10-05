package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCaptureCommitLifecycle(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-commit")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"type":"session_meta"}`+"\n")

	job := enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)

	final, err := service.catalog.GetCaptureJob(ctx, job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusCommitted) {
		t.Fatalf("job status = %s, want committed (error: %s)", final.Status, final.Error)
	}
	pointer := mustReadPointer(t, service, asset.ID)
	if pointer.GenerationID != final.GenerationID {
		t.Fatalf("pointer generation %s != job generation %s", pointer.GenerationID, final.GenerationID)
	}
	if !pointer.Complete {
		t.Fatalf("pointer should be complete")
	}
	generationDir := service.paths.GenerationDir(asset.ID, pointer.GenerationID)
	manifest, err := readManifestJSON(generationDir)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if !manifest.Complete || len(manifest.Files) != 1 {
		t.Fatalf("unexpected manifest: complete=%v files=%d", manifest.Complete, len(manifest.Files))
	}
	if manifest.GenerationID != pointer.GenerationID {
		t.Fatalf("manifest generation %s does not match directory %s", manifest.GenerationID, pointer.GenerationID)
	}
	if err := verifyGenerationFiles(generationDir, manifest); err != nil {
		t.Fatalf("committed material failed verification: %v", err)
	}
	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("load asset: %v", err)
	}
	if updated.BackupStatus != string(BackupStatusVerified) || updated.MaterialStatus != string(MaterialStatusReadable) {
		t.Fatalf("projection backup=%s material=%s", updated.BackupStatus, updated.MaterialStatus)
	}
	if updated.LatestGenerationID != pointer.GenerationID || !updated.LatestComplete {
		t.Fatalf("projection latest fields wrong: %+v", updated)
	}
}

func TestReArchiveReplacesLatestAndCleansOld(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-rearchive")
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "rollout.jsonl")

	writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)
	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	first := mustReadPointer(t, service, asset.ID)

	writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`+"\n"+`{"rev":2}`)
	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	second := mustReadPointer(t, service, asset.ID)

	if first.GenerationID == second.GenerationID {
		t.Fatalf("latest pointer was not advanced: %s", first.GenerationID)
	}
	entries, err := os.ReadDir(service.paths.GenerationsDir(asset.ID))
	if err != nil {
		t.Fatalf("read generations: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != second.GenerationID {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("expected only latest generation, got %v", names)
	}
	manifest, err := readManifestJSON(service.paths.GenerationDir(asset.ID, second.GenerationID))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if err := verifyGenerationFiles(service.paths.GenerationDir(asset.ID, second.GenerationID), manifest); err != nil {
		t.Fatalf("new latest failed verification: %v", err)
	}
}

func TestPartialCandidateDiscardedWhenCompleteExists(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-partial-keep")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)

	enqueueSimpleCapture(t, service, asset.ID, sourceID, sourcePath)
	runQueue(t, service)
	complete := mustReadPointer(t, service, asset.ID)

	job, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerManualRetry), NativeThreadID: "thread-partial-keep",
		SourcePath: sourcePath,
		Files: []MaterialFile{{
			RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary),
		}},
		Missing: []MissingRecord{{Reason: string(MissingAncestor), Detail: "ancestor file unavailable"}},
	})
	if err != nil {
		t.Fatalf("enqueue partial: %v", err)
	}
	runQueue(t, service)

	final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusPartialDiscarded) {
		t.Fatalf("job status = %s, want partial_discarded", final.Status)
	}
	after := mustReadPointer(t, service, asset.ID)
	if after.GenerationID != complete.GenerationID {
		t.Fatalf("complete latest was replaced by partial candidate")
	}
	if _, err := os.Stat(service.paths.StagingPath(job.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("discarded candidate staging not cleaned: %v", err)
	}
}

func TestPartialCommittedWithoutLatest(t *testing.T) {
	service := newTestService(t)
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-partial-first")
	sourceDir := t.TempDir()
	sourcePath := writeSourceFile(t, sourceDir, "rollout.jsonl", `{"rev":1}`)

	job, err := service.EnqueueCapture(context.Background(), CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-partial-first",
		SourcePath: sourcePath,
		Files: []MaterialFile{{
			RelPath: "raw/rollout.jsonl", SourcePath: sourcePath, Role: string(MaterialRolePrimary),
		}},
		Missing: []MissingRecord{{Reason: string(MissingAttachment), Detail: "attachment missing before archive"}},
	})
	if err != nil {
		t.Fatalf("enqueue partial: %v", err)
	}
	runQueue(t, service)

	final, err := service.catalog.GetCaptureJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load job: %v", err)
	}
	if final.Status != string(CaptureStatusPartialCommitted) {
		t.Fatalf("job status = %s, want partial_committed", final.Status)
	}
	pointer := mustReadPointer(t, service, asset.ID)
	if pointer.GenerationID != final.GenerationID || pointer.Complete {
		t.Fatalf("partial pointer wrong: %+v", pointer)
	}
	updated, err := service.catalog.GetAsset(context.Background(), asset.ID)
	if err != nil {
		t.Fatalf("load asset: %v", err)
	}
	if updated.BackupStatus != string(BackupStatusIncomplete) || updated.MaterialStatus != string(MaterialStatusMissingDeps) {
		t.Fatalf("partial projection wrong: backup=%s material=%s", updated.BackupStatus, updated.MaterialStatus)
	}
}
