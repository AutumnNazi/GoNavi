package aiservice

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
)

func TestPluginProviderSaveNilPreservesForeignSecretsAndRejects(t *testing.T) {
	for _, kind := range []string{"cli", "header"} {
		t.Run(kind, func(t *testing.T) {
			service, _ := newPluginProviderTestService(t)
			old := pluginProviderTestConfig()
			old.APIKey, old.HasSecret = "keep-selected-key", true
			if kind == "cli" {
				old.CLIEnv = map[string]string{"TOKEN": "foreign-env"}
			} else {
				old.Headers = map[string]string{"Proxy-Authorization": "foreign-header"}
			}
			store := NewProviderConfigStore(service.configDir, service.secretStore)
			if err := store.Save(ProviderConfigStoreSnapshot{Providers: []ai.ProviderConfig{old}, ActiveProvider: old.ID}); err != nil {
				t.Fatal(err)
			}
			snapshot, err := store.LoadRuntime()
			if err != nil {
				t.Fatal(err)
			}
			service.providers = snapshot.Providers
			before, _, err := service.dailySecretStore().GetAIProvider(old.ID)
			if err != nil {
				t.Fatal(err)
			}
			edit := cloneAgentProviderConfig(old)
			edit.APIKey, edit.CLIEnv, edit.Headers = "replacement-must-not-persist", nil, nil
			if err := service.AISaveProvider(edit); err == nil {
				t.Fatal("nil silently corrected an unsupported saved field")
			}
			after, _, err := service.dailySecretStore().GetAIProvider(old.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("failed validation changed the encrypted secret bundle")
			}
		})
	}
}

func TestPluginProviderSaveNilKeepsAllowedSecretsAndEmptyClearsHeaders(t *testing.T) {
	service, _ := newPluginProviderTestService(t)
	config := pluginProviderTestConfig()
	config.APIKey, config.Headers = "keep-selected-key", map[string]string{"Authorization": "keep-allowed-header"}
	if err := service.AISaveProvider(config); err != nil {
		t.Fatal(err)
	}
	edit := cloneAgentProviderConfig(service.providers[0])
	edit.APIKey, edit.Headers = "", nil
	if err := service.AISaveProvider(edit); err != nil {
		t.Fatal(err)
	}
	if got := service.providers[0]; got.APIKey != "keep-selected-key" || got.Headers["Authorization"] != "keep-allowed-header" {
		t.Fatal("nil lost selected allowed secrets")
	}
	edit.Headers = map[string]string{}
	if err := service.AISaveProvider(edit); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewProviderConfigStore(service.configDir, service.secretStore).LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Providers[0].APIKey != "keep-selected-key" || len(loaded.Providers[0].Headers) != 0 {
		t.Fatal("explicit empty snapshot did not clear only the headers")
	}
}

func TestPluginProviderSaveCorrectionDoesNotRestoreForeignSecrets(t *testing.T) {
	fixture := newNativeProviderServiceFixture(t, "http://127.0.0.1:1/v1") // Bind never contacts an upstream.
	service := fixture.service
	old := cloneAgentProviderConfig(fixture.config)
	old.CLIEnv = map[string]string{"TOKEN": "foreign-cli-secret"}
	old.Headers = map[string]string{"Proxy-Authorization": "forbidden-proxy-secret", "Authorization": "allowed-header-secret"}
	old.HasSecret = true
	store := NewProviderConfigStore(service.configDir, service.secretStore)
	if err := store.Save(ProviderConfigStoreSnapshot{Providers: []ai.ProviderConfig{old}, ActiveProvider: old.ID}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	service.providers, service.activeProvider = snapshot.Providers, old.ID
	clean := cloneAgentProviderConfig(snapshot.Providers[0])
	clean.APIKey = "" // Existing selected credential is intentionally redacted, not deleted.
	clean.CLIEnv = map[string]string{}
	clean.Headers = map[string]string{} // Explicitly clear all headers, including unsupported opaque values.
	if err := service.AISaveProvider(clean); err != nil {
		t.Fatal(err)
	}
	saved, err := store.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Providers) != 1 {
		t.Fatal("saved provider was lost")
	}
	corrected := saved.Providers[0]
	if len(corrected.CLIEnv) != 0 {
		t.Fatal("successful save restored explicitly cleared CLIEnv")
	}
	for name := range corrected.Headers {
		if strings.EqualFold(name, "Proxy-Authorization") {
			t.Fatal("successful save restored deleted forbidden header")
		}
	}
	if corrected.APIKey != old.APIKey || len(corrected.Headers) != 0 {
		t.Fatal("explicit header correction must retain only the selected API key")
	}
	service.providers = saved.Providers
	request := runharness.AgentInputRequest{RequestID: "corrected-provider", Provider: old.ID, Content: "bind only"}
	if err := service.bindAgentProviderInput(context.Background(), &request); err != nil {
		t.Fatalf("corrected saved configuration cannot bind: %v", err)
	}
}
