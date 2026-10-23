package app

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestPluginExportStrictTasksRejectDuplicateAndBoundSlots(t *testing.T) {
	a := &App{ctx: context.Background()}
	contexts := make([]context.Context, 0, 4)
	finishes := make([]func(), 0, 4)
	for i := 0; i < 4; i++ {
		ctx, finish, err := a.beginPluginExportTask(a.ctx, fmt.Sprintf("export-%d", i))
		if err != nil {
			t.Fatal(err)
		}
		contexts = append(contexts, ctx)
		finishes = append(finishes, finish)
		defer finish()
	}
	if _, _, err := a.beginPluginExportTask(a.ctx, "export-4"); !errors.Is(err, errPluginExportBusy) {
		t.Fatal("unbounded strict task admission")
	}
	if _, _, err := a.beginPluginExportTask(a.ctx, "export-0"); !errors.Is(err, errPluginExportBusy) {
		t.Fatal("duplicate strict job accepted")
	}
	legacy, finish := a.beginCancelableExportTask("export-0")
	defer finish()
	if !errors.Is(legacy.Err(), context.Canceled) {
		t.Fatal("legacy collision received an executable Background context")
	}
	if err := a.requestExportTaskCancellation("export-0"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(contexts[0].Err(), context.Canceled) {
		t.Fatal("legacy collision replaced strict cancellation registration")
	}
	if _, _, err := a.beginPluginExportTask(a.ctx, "export-4"); !errors.Is(err, errPluginExportBusy) {
		t.Fatal("cancel released slot before operation finished")
	}
	finishes[0]()
	_, release, err := a.beginPluginExportTask(a.ctx, "export-4")
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestPluginExportStrictTaskInheritsBothLifetimes(t *testing.T) {
	for _, source := range []string{"request", "app", "plugin_runtime"} {
		t.Run(source, func(t *testing.T) {
			appCtx, stopApp := context.WithCancel(context.Background())
			defer stopApp()
			requestCtx, stopRequest := context.WithCancel(context.Background())
			defer stopRequest()
			a := &App{ctx: appCtx}
			runtimeCtx, stopRuntime := context.WithCancel(context.Background())
			defer stopRuntime()
			a.plugins.lifetime = runtimeCtx
			ctx, finish, err := a.beginPluginExportTask(requestCtx, "export-lifetime")
			if err != nil {
				t.Fatal(err)
			}
			defer finish()
			if source == "app" {
				stopApp()
			} else if source == "plugin_runtime" {
				stopRuntime()
			} else {
				stopRequest()
			}
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
				t.Fatal("strict task outlived its parent")
			}
		})
	}
}

func TestPluginExportStrictTaskRejectsMalformedIdentity(t *testing.T) {
	a := &App{ctx: context.Background()}
	for _, id := range []string{"", " export-1", "export-1 ", "export\n1", "导出-1"} {
		if _, _, err := a.beginPluginExportTask(a.ctx, id); !errors.Is(err, errPluginExportJob) {
			t.Fatalf("malformed job accepted: %q", id)
		}
	}
	if _, _, err := a.beginPluginExportTask(nil, "export-1"); err == nil {
		t.Fatal("missing request root accepted")
	}
	legacy, finish := a.beginCancelableExportTask("legacy")
	defer finish()
	if _, _, err := a.beginPluginExportTask(a.ctx, "legacy"); !errors.Is(err, errPluginExportBusy) {
		t.Fatal("strict task replaced active legacy slot")
	}
	if legacy.Err() != nil {
		t.Fatal("strict refusal canceled unrelated legacy work")
	}
}
