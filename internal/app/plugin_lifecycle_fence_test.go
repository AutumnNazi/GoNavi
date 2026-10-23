package app

import (
	"context"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginShutdownCancelsInitializingWindowFactory(t *testing.T) {
	a := newPluginTestApp(t)
	entered := make(chan struct{})
	ConfigurePluginWindows(a, func(ctx context.Context, _ *plugin.Manager) (PluginWindowHost, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	done := make(chan struct{})
	go func() { defer close(done); a.PluginList() }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("factory not entered")
	}
	a.shutdownPlugins()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("initializer outlived shutdown")
	}
	if _, err := PluginManagerForIntegration(context.Background(), a); err == nil {
		t.Fatal("shutdown still advertises execution owner")
	}
}

func TestPluginDataRootRequiresExplicitDisable(t *testing.T) {
	a := newPluginTestApp(t)
	id := installPluginTestPackage(t, a)
	if result := a.PluginSetEnabled(id, true); !result.Success {
		t.Fatalf("enable: %+v", result)
	}
	if resume, err := a.suspendPluginsForRootChange(); err == nil {
		resume()
		t.Fatal("root migration accepted enabled plugin")
	}
	if result := a.PluginList(); !result.Success {
		t.Fatal("rejected migration disabled management")
	}
	if result := a.PluginSetEnabled(id, false); !result.Success {
		t.Fatalf("disable: %+v", result)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		statuses := a.PluginList().Data.([]plugin.Status)
		if len(statuses) == 1 && statuses[0].State == plugin.StateDisabled {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("plugin did not disable")
		}
		time.Sleep(10 * time.Millisecond)
	}
	resume, err := a.suspendPluginsForRootChange()
	if err != nil {
		t.Fatal(err)
	}
	if result := a.PluginList(); result.Success {
		t.Fatal("runtime reopened during suspended root")
	}
	a.configDir = t.TempDir()
	resume()
	if result := a.PluginList(); !result.Success {
		t.Fatalf("new root failed: %+v", result)
	}
}
