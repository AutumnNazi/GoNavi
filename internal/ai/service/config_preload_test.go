package aiservice

import (
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/ai"
)

// A host serves bindings before the lifecycle callback runs: Wails invokes
// OnStartup in its own goroutine, so the AI panel's first provider read can
// arrive first. That read must already see the persisted providers — otherwise
// the panel tells the user nothing is configured on every launch, and never
// re-reads because no event follows the late load.
func TestPreloadConfigServesPersistedProvidersBeforeLifecycle(t *testing.T) {
	dir := t.TempDir()
	writeAIConfigFixture(t, dir, []ai.ProviderConfig{
		{ID: "provider-a", Type: "openai", Name: "TokenRouter", APIFormat: "openai-responses",
			BaseURL: "https://api.example.test/v1", Model: "deepseek/deepseek-v4-flash-0731", HasSecret: true},
		{ID: "provider-b", Type: "custom", Name: "Codex CLI", APIFormat: "codex-cli", AuthMode: "local-cli"},
	}, "provider-a")

	service := NewServiceWithSecretStore(nil)
	service.configDir = dir
	if providers := service.AIGetProviders(); len(providers) != 0 {
		t.Fatalf("a service that has not loaded yet must read as empty, got %+v", providers)
	}

	PreloadConfig(service)

	// These are the reads the composer's readiness check makes on mount.
	providers := service.AIGetProviders()
	if len(providers) != 2 {
		t.Fatalf("provider list after preload = %d entries, want 2: %+v", len(providers), providers)
	}
	if got := service.AIGetActiveProvider(); got != "provider-a" {
		t.Fatalf("active provider after preload = %q, want provider-a", got)
	}
	if got := service.AIGetSafetyLevel(); got != string(ai.PermissionReadOnly) {
		t.Fatalf("safety level after preload = %q, want the persisted readonly", got)
	}
}

// The load happens once per directory: reads served afterwards must not depend
// on the file still being there.
func TestEnsureConfigLoadedLoadsOncePerDirectory(t *testing.T) {
	dir := t.TempDir()
	writeAIConfigFixture(t, dir, []ai.ProviderConfig{
		{ID: "provider-a", Type: "openai", Name: "First"},
	}, "provider-a")

	service := NewServiceWithSecretStore(nil)
	service.configDir = dir
	PreloadConfig(service)
	PreloadConfig(service)

	if err := os.Remove(filepath.Join(dir, aiConfigFileName)); err != nil {
		t.Fatal(err)
	}
	providers := service.AIGetProviders()
	if len(providers) != 1 || providers[0].ID != "provider-a" {
		t.Fatalf("a repeated preload must not re-read the file: %+v", providers)
	}
}

// The data root can move between the preload and later calls, so the directory,
// not just a "loaded" flag, decides whether the configuration is current.
func TestEnsureConfigLoadedFollowsConfigDirChange(t *testing.T) {
	firstDir, secondDir := t.TempDir(), t.TempDir()
	writeAIConfigFixture(t, firstDir, []ai.ProviderConfig{
		{ID: "provider-first", Type: "openai", Name: "First"},
	}, "provider-first")
	writeAIConfigFixture(t, secondDir, []ai.ProviderConfig{
		{ID: "provider-second", Type: "openai", Name: "Second"},
		{ID: "provider-extra", Type: "openai", Name: "Extra"},
	}, "provider-second")

	service := NewServiceWithSecretStore(nil)
	service.configDir = firstDir
	PreloadConfig(service)
	if providers := service.AIGetProviders(); len(providers) != 1 || providers[0].ID != "provider-first" {
		t.Fatalf("first directory not loaded: %+v", providers)
	}

	service.configDir = secondDir
	PreloadConfig(service)
	providers := service.AIGetProviders()
	if len(providers) != 2 || providers[0].ID != "provider-second" {
		t.Fatalf("provider list did not follow the new config dir: %+v", providers)
	}
	if got := service.AIGetActiveProvider(); got != "provider-second" {
		t.Fatalf("active provider = %q, want provider-second", got)
	}
}

// A failed read must not be remembered as loaded, or the service would report
// "nothing configured" for the rest of the session.
func TestPreloadConfigRetriesAfterAFailedLoad(t *testing.T) {
	dir := t.TempDir()
	// A directory at the config path makes the read fail deterministically.
	if err := os.Mkdir(filepath.Join(dir, aiConfigFileName), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewServiceWithSecretStore(nil)
	service.configDir = dir
	PreloadConfig(service)
	if providers := service.AIGetProviders(); len(providers) != 0 {
		t.Fatalf("unreadable config must read as empty, got %+v", providers)
	}

	if err := os.Remove(filepath.Join(dir, aiConfigFileName)); err != nil {
		t.Fatal(err)
	}
	writeAIConfigFixture(t, dir, []ai.ProviderConfig{
		{ID: "provider-recovered", Type: "openai", Name: "Recovered"},
	}, "provider-recovered")

	PreloadConfig(service)
	providers := service.AIGetProviders()
	if len(providers) != 1 || providers[0].ID != "provider-recovered" {
		t.Fatalf("a failed load must be retried, got %+v", providers)
	}
}
