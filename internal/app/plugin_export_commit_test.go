package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/dataexport"
	"GoNavi-Wails/internal/plugin"
	"GoNavi-Wails/internal/uievents"
)

type pluginExportFileProbe struct {
	file                  *os.File
	afterSync, afterClose func()
	syncErr, closeErr     error
}

func (p *pluginExportFileProbe) Write(data []byte) (int, error) { return p.file.Write(data) }
func (p *pluginExportFileProbe) Sync() error {
	if err := p.file.Sync(); err != nil {
		return err
	}
	if p.afterSync != nil {
		p.afterSync()
	}
	return p.syncErr
}
func (p *pluginExportFileProbe) Close() error {
	err := p.file.Close()
	if p.afterClose != nil {
		p.afterClose()
	}
	return errors.Join(err, p.closeErr)
}

type pluginExportCancelEmitter struct {
	status string
	cancel context.CancelFunc
}

func (e pluginExportCancelEmitter) Emit(name string, args ...any) {
	if name != exportProgressEvent || len(args) == 0 {
		return
	}
	if payload, ok := args[0].(exportProgressPayload); ok && payload.Status == e.status {
		e.cancel()
	}
}

func nativePluginExportDocument(t *testing.T, f nativePluginExportFixture) (*dataexport.PluginExporter, []byte) {
	t.Helper()
	exporter, err := dataexport.NewPluginExporter(f.ctx, f.manager, f.options().Format, f.pin)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := dataexport.PreparePluginExportSnapshot(f.ctx, []map[string]any{{"v": "native"}}, []string{"v"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	content, err := exporter.Render(f.ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return exporter, content
}

func TestPluginExportCommitFencesSyncCloseAndExternalDependency(t *testing.T) {
	for _, scenario := range []string{"sync_error", "close_error", "cancel_sync", "disable_close", "root_close", "external_dependency_sync"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := newNativePluginExportFixture(t, scenario == "external_dependency_sync")
			exporter, content := nativePluginExportDocument(t, fixture)
			destination := filepath.Join(t.TempDir(), "result.ndjson")
			if err := os.WriteFile(destination, []byte("OLD"), 0o600); err != nil {
				t.Fatal(err)
			}
			target, err := createAtomicExportTarget(destination)
			if err != nil {
				t.Fatal(err)
			}
			defer target.abort()
			realFile, ok := target.file.(*os.File)
			if !ok {
				t.Fatal("unexpected target type")
			}
			probe := &pluginExportFileProbe{file: realFile}
			target.file = probe
			ctx, cancel := context.WithCancel(fixture.ctx)
			defer cancel()
			switch scenario {
			case "sync_error":
				probe.syncErr = errors.New("fixture sync failed")
			case "close_error":
				probe.closeErr = errors.New("fixture close failed")
			case "cancel_sync":
				probe.afterSync = cancel
			case "disable_close":
				probe.afterClose = func() {
					if _, err := fixture.manager.SetEnabled(ctx, "sdk.examples.ndjson", false); err != nil {
						t.Fatal(err)
					}
				}
			case "root_close":
				probe.afterClose = func() { fixture.app.configDir = t.TempDir() }
			case "external_dependency_sync":
				probe.afterSync = func() {
					controller, err := plugin.NewManager(plugin.Options{Root: filepath.Join(fixture.root, "plugins")})
					if err != nil {
						t.Fatal(err)
					}
					defer controller.Close(context.Background())
					if _, err := controller.SetEnabled(ctx, "test.export-dependency", false); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := target.file.Write(content); err != nil {
				t.Fatal(err)
			}
			result := fixture.app.finishPluginExport(ctx, target, 1, nil, func() error {
				return fixture.app.checkPluginExport(ctx, fixture.manager, exporter, fixture.root, destination)
			})
			fixture.app.configDir = fixture.root
			if result.Success || target.replaceAttempted {
				t.Fatalf("pre-replace failure published: %+v", result)
			}
			previous, err := os.ReadFile(destination)
			if err != nil || string(previous) != "OLD" {
				t.Fatal("precommit failure replaced the old destination")
			}
			target.abort()
			assertNoTempExportResidue(t, filepath.Dir(destination))
		})
	}
}

func TestPluginExportCommittedAndUnknownResultsSurviveLateCancellation(t *testing.T) {
	fixture := newNativePluginExportFixture(t, false)
	_, content := nativePluginExportDocument(t, fixture)
	for _, unknown := range []bool{false, true} {
		ctx, cancel := context.WithCancel(fixture.ctx)
		destination := filepath.Join(t.TempDir(), "result.ndjson")
		status := "done"
		if unknown {
			if err := os.Mkdir(destination, 0o700); err != nil {
				t.Fatal(err)
			}
			status = "error"
		}
		fixture.app.ctx = uievents.WithEmitter(ctx, pluginExportCancelEmitter{status: status, cancel: cancel})
		reporter := newExportProgressReporter(fixture.app, fixture.options(), "snapshot", destination)
		result := fixture.app.publishPluginExport(ctx, destination, content, 1, reporter, func() error { return nil })
		if ctx.Err() == nil {
			t.Fatal("late cancellation fixture did not fire")
		}
		if unknown {
			data, ok := result.Data.(map[string]any)
			if !ok || result.Success || data["outcomeUnknown"] != true || data["canceled"] == true {
				t.Fatalf("unknown replaced by cancellation: %+v", result)
			}
			if info, err := os.Stat(destination); err != nil || !info.IsDir() {
				t.Fatal("unknown result deleted its target")
			}
		} else {
			if !result.Success {
				t.Fatal("committed success relabeled canceled")
			}
			actual, err := os.ReadFile(destination)
			if err != nil || string(actual) != string(content) {
				t.Fatal("successful publication missing")
			}
		}
		assertNoTempExportResidue(t, filepath.Dir(destination))
		cancel()
	}
}
