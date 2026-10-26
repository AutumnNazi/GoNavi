package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginToolCatalogRealGenerationFence(t *testing.T) {
	packagePath := buildCatalogPackage(t, "./hello", "./hello/gonavi.plugin.json")
	ctx, manager, catalog := openCatalogPackage(t, packagePath)
	frozen, err := runharness.FreezeToolCatalog(ctx, catalog)
	if err != nil || len(frozen.Descriptors) != 1 {
		t.Fatalf("freeze: %+v %v", frozen, err)
	}
	name := frozen.Descriptors[0].Name
	resolved, oldExecutor, err := catalog.Resolve(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	// Returned descriptor buffers must not alter the captured executor contract.
	resolved.Capabilities[0] = "mutated"
	resolved.InputSchema[0] = 'x'
	request := runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectSideEffectUnknown, Arguments: json.RawMessage(`{"name":"Agent"}`)}
	result, err := oldExecutor.Execute(ctx, request)
	if err != nil || result.Status != "completed" {
		t.Fatalf("execute: %+v %v", result, err)
	}
	raw, ok := result.Value.(json.RawMessage)
	if !ok || string(raw) != `{"message":"Hello, Agent!"}` {
		t.Fatalf("handler result: %v", result.Value)
	}
	if _, err := manager.SetEnabled(ctx, "example.hello", false); err != nil {
		t.Fatal(err)
	}
	if descriptors, err := catalog.List(ctx); err != nil || len(descriptors) != 0 {
		t.Fatalf("disabled list: %v %v", descriptors, err)
	}
	if result, err := oldExecutor.Execute(ctx, request); !errors.Is(err, ErrAgentToolNotFound) || result.UnknownOutcome {
		t.Fatalf("disabled executor: %+v %v", result, err)
	}
	if _, err := manager.SetEnabled(ctx, "example.hello", true); err != nil {
		t.Fatal(err)
	}
	live := waitCatalogTool(t, ctx, catalog)
	if live.Name != name || runharness.ToolDescriptorEqual(frozen.Descriptors[0], live) {
		t.Fatal("re-enable did not change frozen descriptor identity")
	}
	if result, err := oldExecutor.Execute(ctx, request); !errors.Is(err, runharness.ErrToolDescriptorMismatch) || result.UnknownOutcome {
		t.Fatalf("old generation executor: %+v %v", result, err)
	}
	_, executor, err := catalog.Resolve(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := executor.Execute(ctx, request); err != nil || result.Status != "completed" {
		t.Fatalf("new generation executor: %+v %v", result, err)
	}
}

func TestPluginToolCatalogCancellationIsUnknownNotReplayable(t *testing.T) {
	packagePath := buildCatalogPackage(t, "./hello", "./hello/gonavi.plugin.json")
	ctx, _, catalog := openCatalogPackage(t, packagePath)
	descriptor := waitCatalogTool(t, ctx, catalog)
	_, executor, err := catalog.Resolve(ctx, descriptor.Name)
	if err != nil {
		t.Fatal(err)
	}
	request := runharness.ToolExecutionRequest{ToolName: descriptor.Name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage(`{}`)}
	if result, err := executor.Execute(ctx, request); !errors.Is(err, ErrAgentToolEffect) || result.UnknownOutcome {
		t.Fatalf("effect downgrade: %+v %v", result, err)
	}
	request.Effect = runharness.ToolEffectSideEffectUnknown
	request.Arguments = json.RawMessage(`{"delayMillis":60000}`)
	call, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	result, err := executor.Execute(call, request)
	if !errors.Is(err, context.DeadlineExceeded) || !result.UnknownOutcome || result.Status != "unknown" {
		t.Fatalf("cancelled effect: %+v %v", result, err)
	}
	if err.Error() != "plugin tool invocation failed" {
		t.Fatalf("plugin diagnostic leaked: %v", err)
	}
}

func TestPluginToolCatalogHandshakeWaitIsBounded(t *testing.T) {
	packagePath := buildCatalogPackage(t, "./failure", "./fixtures/hang/gonavi.plugin.json")
	manifestPath := filepath.Join(packagePath, "gonavi.plugin.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Permissions = []string{"ai.tools"}
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, _, catalog := openCatalogPackage(t, packagePath)
	catalog.startupWait = 20 * time.Millisecond
	started := time.Now()
	descriptors, err := catalog.List(ctx)
	if err != nil || len(descriptors) != 0 {
		t.Fatalf("unready catalog: %v %v", descriptors, err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("plugin handshake blocked catalog beyond its wait budget")
	}
	call, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := catalog.List(call); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled discovery: %v", err)
	}
}

func buildCatalogPackage(t *testing.T, source, manifest string) string {
	t.Helper()
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "run", "./package", "-source", source, "-manifest", manifest, "-output", output)
	command.Dir = filepath.Join(repo, "examples", "plugins")
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	logs, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("build catalog plugin: %v\n%s", err, logs)
	}
	return output
}

func openCatalogPackage(t *testing.T, packagePath string) (context.Context, *plugin.Manager, *PluginToolCatalog) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	manager, err := plugin.NewManager(plugin.Options{Root: t.TempDir(), HandshakeTimeout: 2 * time.Second})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := manager.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	inspection, err := manager.Inspect(ctx, packagePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Install(ctx, plugin.InstallRequest{Path: packagePath, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(ctx, inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	catalog := NewPluginToolCatalog(func(context.Context) (*plugin.Manager, error) { return manager, nil })
	return ctx, manager, catalog
}

func waitCatalogTool(t *testing.T, ctx context.Context, catalog *PluginToolCatalog) runharness.ToolDescriptor {
	t.Helper()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		descriptors, err := catalog.List(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(descriptors) == 1 {
			return descriptors[0]
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
