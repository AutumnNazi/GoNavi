package sessionassets

import (
	"context"
	"os"

	"strings"
	"testing"
)

func TestPrepareHandoffMaterialsWritesNoteAndRecord(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	asset, _ := syncArchivedAsset(t, service, source, "thread-handoff")
	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	plan, err := service.PrepareHandoffMaterials(ctx, detail, `C:\work\demo`, HandoffScope{Mode: HandoffScopeRecent}, "", nil, nil)
	if err != nil {
		t.Fatalf("prepare handoff: %v", err)
	}
	if plan.Stage != HandoffStageMaterialsReady || plan.MaterialsDir == "" {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	note, err := os.ReadFile(plan.NoteFile)
	if err != nil {
		t.Fatalf("read note: %v", err)
	}
	text := string(note)
	for _, expected := range []string{
		asset.NativeThreadID,
		"codex resume " + asset.NativeThreadID,
		"raw/rollout.jsonl",
		`C:\work\demo`,
		"不代表原会话被恢复",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("note missing %q in:\n%s", expected, text)
		}
	}
}

func TestPrepareHandoffFailsWithoutMaterial(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	asset := seedAsset(t, service, integrationID, sourceID, "thread-bare-handoff")
	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	plan, err := service.PrepareHandoffMaterials(ctx, detail, "", HandoffScope{Mode: HandoffScopeRecent}, "", nil, nil)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if plan.Stage != HandoffStageFailed {
		t.Fatalf("stage = %s, want failed", plan.Stage)
	}
}

func TestCanResumeNativelyRequiresReadableSource(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	_, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}
	asset, session := syncArchivedAsset(t, service, source, "thread-resume")
	detail, err := service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if !CanResumeNatively(detail, detail.Provider) {
		t.Fatalf("native resume should be available while source exists and provider matches")
	}
	if CanResumeNatively(detail, "different-provider") {
		t.Fatalf("cross-provider native resume must be rejected")
	}
	if err := os.Remove(session.NativePath); err != nil {
		t.Fatalf("remove source file: %v", err)
	}
	detail, err = service.AssetDetail(ctx, asset.ID)
	if err != nil {
		t.Fatalf("detail after removal: %v", err)
	}
	if CanResumeNatively(detail, detail.Provider) {
		t.Fatalf("native resume must be unavailable when the source file is gone")
	}
}

func TestHandoffDirEscapesAssetScope(t *testing.T) {
	service := newTestService(t)
	if _, err := service.PrepareHandoffMaterials(context.Background(), AssetDetail{AssetView: AssetView{ID: "..\\evil"}}, "", HandoffScope{}, "", nil, nil); err == nil {
		t.Fatalf("asset id with separators must be rejected")
	}
}
