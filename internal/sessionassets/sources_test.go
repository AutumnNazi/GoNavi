package sessionassets

import (
	"context"
	"errors"
	"testing"
)

func TestRelocateSourceAndConflict(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	// 第二个来源占据目标身份，重定位必须拒绝（V-22）。
	if _, err := service.catalog.UpsertSource(ctx, SourceInput{
		IntegrationID: integrationID,
		RootPath:      `D:\elsewhere`,
		IdentityKey:   "dir:d-/elsewhere",
	}); err != nil {
		t.Fatalf("seed second source: %v", err)
	}
	if err := service.catalog.RelocateSource(ctx, sourceID, `D:\elsewhere`, "dir:d-/elsewhere"); !errors.Is(err, ErrSourceConflict) {
		t.Fatalf("conflicting relocation should fail, got %v", err)
	}
	if err := service.catalog.RelocateSource(ctx, sourceID, `D:\newroot`, "dir:d-/newroot"); err != nil {
		t.Fatalf("clean relocation: %v", err)
	}
	relocated, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load relocated: %v", err)
	}
	if relocated.RootPath != `D:\newroot` || relocated.IdentityKey != "dir:d-/newroot" {
		t.Fatalf("relocation not applied: %+v", relocated)
	}
}
