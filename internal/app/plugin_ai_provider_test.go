package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginAIProviderFactoryConstructionAndEmptyCatalogDoNotStart(t *testing.T) {
	a := newPluginTestApp(t)
	ConfigurePluginWindows(a, func(context.Context, *plugin.Manager) (PluginWindowHost, error) {
		t.Fatal("provider discovery started window execution")
		return nil, nil
	})
	factory := PluginAIProviderFactoryForIntegration(a)
	if factory == nil {
		t.Fatal("factory missing")
	}
	if _, err := os.Stat(filepath.Join(a.configDir, "plugins")); !os.IsNotExist(err) {
		t.Fatalf("factory construction performed IO: %v", err)
	}
	if _, err := PluginAIProviderManagerForIntegration(a.ctx, a); err == nil {
		t.Fatal("manager getter initialized execution")
	}
	raw := pluginAIProviderCatalogJSON(t, a.PluginAIProviders())
	if string(raw) != `{"items":[]}` {
		t.Fatalf("empty catalog must contain an array: %s", raw)
	}
	requirePluginSkillNoStartup(t, a)
}

func TestPluginAIProviderCatalogIsStaticAndMetadataOnly(t *testing.T) {
	a, manager, status, executable := installPluginAIProviderMetadata(t)
	before := pluginAIProviderCatalogJSON(t, a.PluginAIProviders())
	var catalog struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(before, &catalog); err != nil || len(catalog.Items) != 1 {
		t.Fatalf("missing declared provider metadata: %s %v", before, err)
	}
	item := catalog.Items[0]
	for key, want := range map[string]string{
		"type": `"plugin:test.providers:text"`, "pluginId": `"test.providers"`,
		"id": `"text"`, "name": `"Text provider"`, "version": `"1.0.0"`,
		"supportsTools": "true", "supportsImages": "false", "available": "false", "reason": `"disabled"`,
	} {
		if string(item[key]) != want {
			t.Errorf("%s = %s, want %s", key, item[key], want)
		}
	}
	for _, key := range []string{"models", "digest", "generation", "state"} {
		if len(item[key]) == 0 {
			t.Errorf("catalog omitted %s", key)
		}
	}
	if strings.Contains(string(before), "command") || strings.Contains(string(before), "apiKey") || strings.Contains(string(before), "secretRef") {
		t.Fatal("catalog exposed execution or credential fields")
	}
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
	after := pluginAIProviderCatalogJSON(t, a.PluginAIProviders())
	if string(before) != string(after) {
		t.Fatal("catalog read the installed executable")
	}
	if _, err := manager.SetEnabled(a.ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	raw := pluginAIProviderCatalogJSON(t, a.PluginAIProviders())
	if !strings.Contains(string(raw), `"available":false`) || manager.OwnsRuntime() {
		t.Fatal("cold metadata activated or advertised execution")
	}
	requirePluginSkillNoStartup(t, a)
}

func TestPluginAIProviderCatalogPolicyAndCancellation(t *testing.T) {
	for _, mode := range []string{"web", "canceled", "safe"} {
		t.Run(mode, func(t *testing.T) {
			a := newPluginTestApp(t)
			ctx := a.ctx
			switch mode {
			case "web":
				a.webRuntime = true
			case "canceled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case "safe":
				t.Setenv("GONAVI_DISABLE_PLUGINS", "true")
			}
			factory := PluginAIProviderFactoryForIntegration(a)
			_, err := factory.Catalog(ctx)
			if mode == "safe" {
				if err != nil {
					t.Fatal("safe mode must retain static metadata:", err)
				}
			} else if err == nil {
				t.Fatal("catalog accepted denied or canceled request")
			}
			if mode == "web" {
				requirePluginSkillFailure(t, a.pluginAIProvidersContext(ctx), "management_denied")
			}
			if _, err := PluginAIProviderManagerForIntegration(ctx, a); err == nil {
				t.Fatal("policy returned an execution manager")
			} else if mode == "canceled" && !errors.Is(err, context.Canceled) {
				t.Fatal("manager getter lost cancellation:", err)
			}
			requirePluginSkillNoStartup(t, a)
		})
	}
}

func TestPluginAIProviderManagerBorrowsMetadataOwnerAndFencesRoot(t *testing.T) {
	a := newPluginTestApp(t)
	manager := newPluginSkillController(t, a)
	if err := manager.Start(a.ctx); err != nil {
		t.Fatal(err)
	}
	attachPluginSkillController(a, manager)
	session := newMetadataSessionWithMode(a, a.ctx, true)
	defer session.Close()
	got, err := PluginAIProviderManagerForIntegration(a.ctx, session.app)
	if err != nil || got != manager || session.app.plugins.manager != nil {
		t.Fatalf("metadata request failed to borrow its owner: %v", err)
	}
	a.configDir = t.TempDir()
	if _, err := PluginAIProviderManagerForIntegration(a.ctx, session.app); err == nil {
		t.Fatal("manager getter returned a previous data-root owner")
	}
	if result := session.app.PluginAIProviders(); result.Success {
		t.Fatal("metadata catalog read the previous data root")
	}
}

func TestPluginAIProviderIntegrationIsNotReflective(t *testing.T) {
	for _, name := range []string{"PluginAIProviderFactoryForIntegration", "PluginAIProviderManagerForIntegration"} {
		if _, ok := reflect.TypeOf((*App)(nil)).MethodByName(name); ok {
			t.Fatalf("host capability %s exposed through reflective App bindings", name)
		}
	}
	if _, err := PluginAIProviderManagerForIntegration(context.Background(), nil); err == nil {
		t.Fatal("nil App accepted")
	}
	if _, err := PluginAIProviderManagerForIntegration(nil, newPluginTestApp(t)); err == nil {
		t.Fatal("nil lifecycle accepted")
	}
}

func pluginAIProviderCatalogJSON(t *testing.T, result connection.QueryResult) []byte {
	t.Helper()
	catalog, ok := result.Data.(PluginAIProviderCatalog)
	if !result.Success || !ok || catalog.Items == nil {
		t.Fatalf("invalid provider catalog: success=%t type=%T", result.Success, result.Data)
	}
	raw, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func installPluginAIProviderMetadata(t *testing.T) (*App, *plugin.Manager, plugin.Status, string) {
	t.Helper()
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a := newPluginTestApp(t)
	root := t.TempDir()
	manifest := plugin.Manifest{
		SchemaVersion: 1, APIVersion: 1, ID: "test.providers", Name: "Providers", Version: "1.0.0",
		Permissions: []string{"ai.providers"}, Backend: &plugin.Backend{Default: &plugin.Entry{Executable: "provider"}},
		Contributes: plugin.Contributions{
			Commands: []plugin.Command{{ID: "generate", Title: "Generate"}},
			AIProviders: []plugin.AIProvider{{ID: "text", Name: "Text provider", Command: "generate", SupportsTools: true,
				Models: []plugin.AIModel{{ID: "test-model", Name: "Test model", ContextWindow: 4096, MaxOutputTokens: 512}}}},
		},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string][]byte{"gonavi.plugin.json": raw, "provider": []byte("METADATA_ONLY_NEVER_EXECUTE")} {
		if err := os.WriteFile(filepath.Join(root, name), body, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	manager := newPluginSkillController(t, a)
	inspection, err := manager.Inspect(a.ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(a.ctx, plugin.InstallRequest{Path: root, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	return a, manager, status, filepath.Join(a.configDir, "plugins", "store", status.Digest, "provider")
}
