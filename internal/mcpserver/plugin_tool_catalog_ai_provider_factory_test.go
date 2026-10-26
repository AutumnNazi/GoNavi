package mcpserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginAIProviderBackendFactoryDoesNotActivateOrStealOwner(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	root := t.TempDir()
	backend, err := NewAppBackendWithDataRoot(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	factory := NewPluginAIProviderFactoryForBackend(backend)
	if _, err := os.Stat(filepath.Join(root, "plugins")); !os.IsNotExist(err) {
		t.Fatalf("factory construction performed plugin IO: %v", err)
	}
	items, err := factory.Catalog(ctx)
	if err != nil || len(items) != 0 {
		t.Fatalf("empty metadata catalog: %d %v", len(items), err)
	}
	config := ai.ProviderConfig{ID: "native", Type: "plugin:test.provider:text", Name: "Native", Model: "test-model"}
	if _, err := factory.Bind(ctx, config); err == nil {
		t.Fatal("binding succeeded without a local execution owner")
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
		t.Fatal("catalog or bind acquired an execution lease:", err)
	}
	if _, err := factory.Bind(ctx, config); err == nil || !probe.OwnsRuntime() {
		t.Fatal("factory borrowed or revoked a foreign execution owner")
	}
}

func TestPluginAIProviderBackendFactoryUnavailableAndCanceled(t *testing.T) {
	for _, backend := range []Backend{nil, (*AppBackend)(nil), catalogBackend()} {
		factory := NewPluginAIProviderFactoryForBackend(backend)
		if factory == nil {
			t.Fatal("missing unavailable factory")
		}
		if _, err := factory.Catalog(context.Background()); err == nil {
			t.Fatal("unsupported backend supplied provider metadata")
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := factory.Catalog(ctx); !errors.Is(err, context.Canceled) {
			t.Fatal("metadata lookup lost caller cancellation:", err)
		}
	}
}
