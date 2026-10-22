package dataexport

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func pluginExporterFixture(t *testing.T, dependency bool) (*plugin.Manager, *PluginExporter, string) {
	t.Helper()
	examples, err := filepath.Abs(filepath.Join("..", "..", "examples", "plugins"))
	if err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	binary := "plugin"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	build := exec.CommandContext(ctx, "go", "build", "-trimpath", "-o", filepath.Join(source, binary), "./ndjson-exporter")
	build.Dir = examples
	build.Env = append(os.Environ(), "CGO_ENABLED=0", "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("independent SDK example build: %v %s", err, output)
	}
	raw, err := os.ReadFile(filepath.Join(examples, "ndjson-exporter", "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if json.Unmarshal(raw, &manifest) != nil {
		t.Fatal("invalid example manifest")
	}
	manifest.Contributes.Exporters[0].Streaming = true
	manifest.Backend = &plugin.Backend{Default: &plugin.Entry{Executable: binary, Runtime: "native"}}
	if dependency {
		manifest.Requires = []plugin.Dependency{{ID: "test.export-dependency", MinVersion: "1.0.0"}}
	}
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	interval := 5 * time.Millisecond
	if dependency {
		interval = time.Hour
	}
	manager, err := plugin.NewManager(plugin.Options{Root: root, ReconcileInterval: interval, ShutdownTimeout: 250 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Install(ctx, plugin.InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	pin := PluginExportSelection{Digest: inspection.Digest, Generation: 1}
	if _, err = NewPluginExporter(ctx, manager, plugin.ExporterType(manifest.ID, manifest.Contributes.Exporters[0]), pin); err == nil || manager.OwnsRuntime() {
		t.Fatal("domain constructor started inactive runtime")
	}
	if dependency {
		pluginInstallExportDependency(t, manager)
	} else {
		if err = manager.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = manager.SetEnabled(ctx, manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	status := pluginWaitExporter(t, manager, manifest.ID)
	exporter, err := NewPluginExporter(ctx, manager, plugin.ExporterType(manifest.ID, manifest.Contributes.Exporters[0]), PluginExportSelection{Digest: status.Digest, Generation: status.Generation})
	if err != nil {
		t.Fatal(err)
	}
	return manager, exporter, root
}
func pluginWaitExporter(t *testing.T, manager *plugin.Manager, id string) plugin.Status {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		for _, status := range manager.List() {
			if status.Manifest.ID == id && status.State == plugin.StateRunning {
				if len(status.Manifest.Contributes.Exporters) == 0 || manager.CheckExporterGeneration(ctx, id, status.Generation, status.Manifest.Contributes.Exporters[0].ID, status.Digest) == nil {
					return status
				}
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("fixture generation not ready")
		case <-ticker.C:
		}
	}
}
func pluginInstallExportDependency(t *testing.T, manager *plugin.Manager) {
	t.Helper()
	source := t.TempDir()
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"test.export-dependency","name":"Dependency","version":"1.0.0","permissions":[]}`)
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Install(ctx, plugin.InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.SetEnabled(ctx, inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	pluginWaitExporter(t, manager, inspection.Manifest.ID)
}
