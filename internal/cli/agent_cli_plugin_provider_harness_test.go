package cli

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/plugin"
)

func TestCLIPluginProviderRealInputBinderPassesRequestContext(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	root := t.TempDir()
	config := cliPluginProviderConfig()
	if err := aiservice.NewProviderConfigStore(root, nil).Save(aiservice.ProviderConfigStoreSnapshot{
		Providers: []ai.ProviderConfig{config}, ActiveProvider: config.ID,
	}); err != nil {
		t.Fatal(err)
	}
	owner, err := defaultAgentHarnessFactory(ctx, AgentHarnessOptions{DataRoot: root, KeyFile: filepath.Join(root, "agent.key")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	runtime := owner.(*ledgerHarnessRuntime)
	type bindingTraceKey struct{}
	requestCtx := context.WithValue(ctx, bindingTraceKey{}, "binding-trace")
	called := false
	runtime.providerResolver.plugins = provider.NewPluginFactory(nil, func(ctx context.Context) (*plugin.Manager, error) {
		called = true
		if ctx.Value(bindingTraceKey{}) != "binding-trace" {
			t.Error("real InputBinder discarded its caller context")
		}
		return nil, errors.New("no local plugin owner")
	})
	_, err = runtime.SubmitInput(requestCtx, runharness.AgentInputRequest{RequestID: "context-bound-input", Content: "hello"})
	if err == nil || !called {
		t.Fatalf("real input did not reach its instance-owned factory: called=%t err=%v", called, err)
	}
}

func TestCLIPluginProviderReadOnlyBindNeverClaimsRuntime(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	root := t.TempDir()
	config := cliPluginProviderConfig()
	if err := aiservice.NewProviderConfigStore(root, nil).Save(aiservice.ProviderConfigStoreSnapshot{
		Providers: []ai.ProviderConfig{config}, ActiveProvider: config.ID,
	}); err != nil {
		t.Fatal(err)
	}
	owner, err := defaultAgentHarnessFactory(ctx, AgentHarnessOptions{DataRoot: root, KeyFile: filepath.Join(root, "agent.key"), StartWorkers: false})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	runtime := owner.(*ledgerHarnessRuntime)
	if runtime.providerResolver.plugins == nil {
		t.Fatal("real CLI factory omitted plugin integration")
	}
	if _, err := runtime.SubmitInput(ctx, runharness.AgentInputRequest{RequestID: "readonly-plugin", Content: "hello"}); err == nil {
		t.Fatal("read-only CLI accepted an unavailable plugin binding")
	}
	probe, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := probe.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	if err := probe.Start(ctx); err != nil {
		t.Fatal("binding activated a read-only CLI runtime:", err)
	}
}
