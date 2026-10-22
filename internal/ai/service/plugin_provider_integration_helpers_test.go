package aiservice

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/plugin"
)

type nativeProviderServiceFixture struct {
	service *Service
	manager *plugin.Manager
	config  ai.ProviderConfig
	ctx     context.Context
}

func newNativeProviderServiceFixture(t *testing.T, baseURL string) nativeProviderServiceFixture {
	t.Helper()
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	examples, err := filepath.Abs("../../../examples/plugins")
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	command := exec.CommandContext(ctx, "go", "-C", examples, "run", "./package", "-source", "./ai-provider", "-manifest", "./ai-provider/gonavi.plugin.json", "-output", output)
	command.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local")
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build independent provider example: %v\n%s", err, result)
	}
	root := t.TempDir()
	manager, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := manager.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	inspection, err := manager.Inspect(ctx, output)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := manager.Install(ctx, plugin.InstallRequest{Path: output, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(ctx, installed.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	config := ai.ProviderConfig{ID: "selected-plugin", Name: "Local HTTP fixture", Type: "plugin:sdk.examples.aiprovider:http", BaseURL: baseURL, APIKey: "selected-test-key", Model: "gpt-4o-mini", Headers: map[string]string{"X-Selected": "yes"}}
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = root
	service.ctx = ctx
	service.agentContext = ctx
	service.providers = []ai.ProviderConfig{config, {ID: "unrelated", Type: "openai", APIKey: "unrelated-secret-never-project", Model: "unused"}}
	service.activeProvider = config.ID
	factory := provider.NewPluginFactory(func(context.Context) (provider.PluginProviderSnapshot, error) {
		return provider.PluginProviderSnapshot{Statuses: manager.List(), Owned: manager.OwnsRuntime()}, nil
	}, func(context.Context) (*plugin.Manager, error) { return manager, nil })
	if err := ConfigurePluginProviderFactory(service, factory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		ShutdownWithContext(service, cleanup)
	})
	return nativeProviderServiceFixture{service: service, manager: manager, config: config, ctx: ctx}
}
