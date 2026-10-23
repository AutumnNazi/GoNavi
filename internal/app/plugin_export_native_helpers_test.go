package app

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/dataexport"
	"GoNavi-Wails/internal/plugin"
	"GoNavi-Wails/internal/secretstore"
)

type nativePluginExportFixture struct {
	app     *App
	manager *plugin.Manager
	pin     dataexport.PluginExportSelection
	root    string
	ctx     context.Context
}

func newNativePluginExportFixture(t *testing.T, withDependency bool) nativePluginExportFixture {
	t.Helper()
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	examples, err := filepath.Abs("../../examples/plugins")
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	command := exec.CommandContext(ctx, "go", "-C", examples, "run", "./package", "-source", "./ndjson-exporter", "-manifest", "./ndjson-exporter/gonavi.plugin.json", "-output", output)
	command.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local")
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build independent NDJSON exporter: %v\n%s", err, result)
	}
	root := t.TempDir()
	controller, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	if withDependency {
		dependency := t.TempDir()
		raw, _ := json.Marshal(plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.export-dependency", Name: "Export dependency", Version: "1.0.0"})
		if err := os.WriteFile(filepath.Join(dependency, "gonavi.plugin.json"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
		installPluginExportPackage(t, ctx, controller, dependency)
		path := filepath.Join(output, "gonavi.plugin.json")
		raw, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		manifest, err := plugin.ParseManifest(raw)
		if err != nil {
			t.Fatal(err)
		}
		manifest.Requires = []plugin.Dependency{{ID: "test.export-dependency"}}
		raw, err = json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	installPluginExportPackage(t, ctx, controller, output)
	if err := controller.Close(ctx); err != nil {
		t.Fatal(err)
	}
	application := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	application.ctx = ctx
	application.configDir = root
	t.Cleanup(application.Shutdown)
	if err := InitializePluginExecution(ctx, application); err != nil {
		t.Fatal(err)
	}
	manager, err := PluginSkillManagerForIntegration(ctx, application)
	if err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		for _, status := range manager.List() {
			if status.Manifest.ID == "sdk.examples.ndjson" && status.State == plugin.StateRunning {
				return nativePluginExportFixture{app: application, manager: manager, root: root, ctx: ctx, pin: dataexport.PluginExportSelection{Digest: status.Digest, Generation: status.Generation}}
			}
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("NDJSON exporter did not become ready")
		}
	}
}

func installPluginExportPackage(t *testing.T, ctx context.Context, manager *plugin.Manager, path string) {
	t.Helper()
	inspection, err := manager.Inspect(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, plugin.InstallRequest{Path: path, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
}

func (f nativePluginExportFixture) options() ExportFileOptions {
	pin := f.pin
	return ExportFileOptions{Format: "plugin:sdk.examples.ndjson:ndjson", PluginExporter: &pin, JobID: "export-native"}
}
