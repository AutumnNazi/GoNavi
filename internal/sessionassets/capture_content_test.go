package sessionassets

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestUnarchiveKeepsBackupAndReArchiveReplaces 是 V-09 的领域路径：
// 取消归档保留副本并指回活动源；再次归档完整提交后才替换 latest。
func TestUnarchiveKeepsBackupAndReArchiveReplaces(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	sessionDir := filepath.Join(source.RootPath, "archived_sessions")
	first := seedRealSession(t, sessionDir, "thread-v09", true)
	discoverer := &fakeDiscoverer{sessions: []DiscoveredSession{first}}
	if _, err := service.SyncSource(ctx, source, discoverer.sessions, true); err != nil {
		t.Fatalf("archive sync: %v", err)
	}
	runQueue(t, service)
	baseline := mustReadPointer(t, service, func() string {
		assets, _ := service.catalog.ListAssets(ctx, integrationID)
		return assets[0].ID
	}())

	// 取消归档：文件回到活动目录（原归档路径消失），重新发现后引用变为
	// active，备份保留。
	activeDir := filepath.Join(source.RootPath, "sessions")
	if err := os.MkdirAll(activeDir, 0o700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	if err := os.Rename(first.NativePath, filepath.Join(activeDir, filepath.Base(first.NativePath))); err != nil {
		t.Fatalf("unarchive move: %v", err)
	}
	reactivated := seedRealSession(t, activeDir, "thread-v09", false)
	discoverer.sessions = []DiscoveredSession{reactivated}
	if _, err := service.SyncSource(ctx, source, discoverer.sessions, true); err != nil {
		t.Fatalf("unarchive sync: %v", err)
	}
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	asset := assets[0]
	refs, _ := service.catalog.ListSourceRefs(ctx, asset.ID)
	if refs[0].SourceStatus != string(SourceStatusActive) {
		t.Fatalf("ref status after unarchive = %s, want active", refs[0].SourceStatus)
	}
	if got := mustReadPointer(t, service, asset.ID); got.GenerationID != baseline.GenerationID {
		t.Fatalf("unarchive must keep the backup")
	}

	// 再次归档：新副本完整提交后替换 latest；旧代次回收。
	if err := os.Rename(reactivated.NativePath, filepath.Join(sessionDir, filepath.Base(first.NativePath))); err != nil {
		t.Fatalf("re-archive move: %v", err)
	}
	reArchived := seedRealSession(t, sessionDir, "thread-v09", true)
	discoverer.sessions = []DiscoveredSession{reArchived}
	if _, err := service.SyncSource(ctx, source, discoverer.sessions, true); err != nil {
		t.Fatalf("re-archive sync: %v", err)
	}
	runQueue(t, service)
	updated, err := service.catalog.GetAsset(ctx, asset.ID)
	if err != nil {
		t.Fatalf("reload asset: %v", err)
	}
	if updated.LatestGenerationID == "" || updated.LatestGenerationID == baseline.GenerationID {
		t.Fatalf("re-archive did not advance latest: %s", updated.LatestGenerationID)
	}
	if updated.BackupStatus != string(BackupStatusVerified) {
		t.Fatalf("backup status after re-archive = %s", updated.BackupStatus)
	}
}

// TestForkAncestorPrefixPreservation 是 V-15 的领域路径：子资产保全包含
// 祖先固定前缀；分叉后父会话新增的内容不混入子资产；祖先缺失时不得
// 标记完整。
func TestForkAncestorPrefixPreservation(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-child")

	root := t.TempDir()
	writeSourceFile(t, root, "parent-before-fork.jsonl", `{"rev":"prefix"}`)
	writeSourceFile(t, root, "parent-after-fork.jsonl", `{"rev":"after-fork"}`)

	// 祖先仅声明分叉点之前的文件。
	request := CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-child",
		Ancestors: []AncestorDependency{{
			NativeThreadID: "thread-parent",
			BoundaryAt:     1000,
			Files: []MaterialFile{{
				RelPath:    "ancestors/thread-parent/parent-before-fork.jsonl",
				SourcePath: filepath.Join(root, "parent-before-fork.jsonl"),
				Role:       string(MaterialRoleAncestor),
			}},
		}},
		Files: []MaterialFile{{
			RelPath:    "raw/rollout.jsonl",
			SourcePath: filepath.Join(root, "child.jsonl"),
			Role:       string(MaterialRolePrimary),
		}},
	}
	if err := os.WriteFile(filepath.Join(root, "child.jsonl"), []byte(`{"rev":"child"}`), 0o600); err != nil {
		t.Fatalf("write child: %v", err)
	}
	if _, err := service.EnqueueCapture(ctx, request); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	runQueue(t, service)

	pointer := mustReadPointer(t, service, asset.ID)
	generationDir := service.paths.GenerationDir(asset.ID, pointer.GenerationID)
	manifest, err := readManifestJSON(generationDir)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if len(manifest.Ancestors) != 1 || manifest.Ancestors[0].NativeThreadID != "thread-parent" {
		t.Fatalf("ancestor dependency not recorded: %+v", manifest.Ancestors)
	}
	if err := verifyGenerationFiles(generationDir, manifest); err != nil {
		t.Fatalf("verify generation: %v", err)
	}
	preserved, err := os.ReadFile(filepath.Join(generationDir, "ancestors", "thread-parent", "parent-before-fork.jsonl"))
	if err != nil || string(preserved) != `{"rev":"prefix"}` {
		t.Fatalf("ancestor prefix not preserved: %v %q", err, string(preserved))
	}
	if _, err := os.Stat(filepath.Join(generationDir, "ancestors", "thread-parent", "parent-after-fork.jsonl")); !os.IsNotExist(err) {
		t.Fatalf("post-fork parent content must not leak into child asset")
	}

	// 祖先缺失：候选不得标完整（FR-09）。
	partial := request
	partial.Ancestors = []AncestorDependency{{
		NativeThreadID: "thread-missing",
		Files:          nil,
	}}
	partial.Missing = []MissingRecord{{Reason: string(MissingAncestor), Detail: "ancestor file unavailable"}}
	partialJob, err := service.EnqueueCapture(ctx, partial)
	if err != nil {
		t.Fatalf("enqueue partial: %v", err)
	}
	runQueue(t, service)
	final, err := service.catalog.GetCaptureJob(ctx, partialJob.ID)
	if err != nil {
		t.Fatalf("load partial job: %v", err)
	}
	if final.Status != string(CaptureStatusPartialDiscarded) {
		t.Fatalf("partial candidate should be discarded when a complete latest exists, got %s", final.Status)
	}
	if got := mustReadPointer(t, service, asset.ID); got.GenerationID != pointer.GenerationID {
		t.Fatalf("partial candidate replaced the complete latest")
	}
}

// TestAttachmentDispositionHandling 是 V-16 的领域路径：可用的外部附件
// 被复制并登记；缺失附件记录为缺失且不伪造完整。
func TestAttachmentDispositionHandling(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-attach")

	root := t.TempDir()
	attachmentPath := writeSourceFile(t, root, "attachment.bin", "attachment-bytes")
	request := CaptureRequest{
		AssetID: asset.ID, SourceID: sourceID,
		Trigger: string(CaptureTriggerArchiveEvent), NativeThreadID: "thread-attach",
		Files: []MaterialFile{
			{RelPath: "raw/rollout.jsonl", SourcePath: writeSourceFile(t, root, "rollout.jsonl", `{"rev":1}`), Role: string(MaterialRolePrimary)},
			{RelPath: "attachments/attachment.bin", SourcePath: attachmentPath, Role: string(MaterialRoleAttachment)},
		},
		Attachments: []AttachmentRecord{
			{Name: "attachment.bin", Disposition: string(AttachmentExternal), RelPath: "attachments/attachment.bin"},
			{Name: "missing.png", Disposition: string(AttachmentMissing)},
		},
		Missing: []MissingRecord{{Reason: string(MissingAttachment), Detail: "missing.png was gone before archive"}},
	}
	if _, err := service.EnqueueCapture(ctx, request); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	runQueue(t, service)

	pointer := mustReadPointer(t, service, asset.ID)
	generationDir := service.paths.GenerationDir(asset.ID, pointer.GenerationID)
	manifest, err := readManifestJSON(generationDir)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if len(manifest.Attachments) != 2 {
		t.Fatalf("attachment inventory wrong: %+v", manifest.Attachments)
	}
	if manifest.Attachments[1].Disposition != string(AttachmentMissing) {
		t.Fatalf("missing attachment disposition wrong: %+v", manifest.Attachments[1])
	}
	// 有缺失 → 候选不完整；无完整 latest 时以部分候选提交（不宣称完整）。
	if manifest.Complete {
		t.Fatalf("candidate with missing attachment must not be complete")
	}
	preserved, err := os.ReadFile(filepath.Join(generationDir, "attachments", "attachment.bin"))
	if err != nil || string(preserved) != "attachment-bytes" {
		t.Fatalf("external attachment not preserved: %v %q", err, string(preserved))
	}
	updated, _ := service.catalog.GetAsset(ctx, asset.ID)
	if updated.BackupStatus != string(BackupStatusIncomplete) {
		t.Fatalf("backup status = %s, want incomplete", updated.BackupStatus)
	}
}
