package aiservice

import (
	"reflect"
	"testing"

	"GoNavi-Wails/internal/ai"
)

func TestPluginProviderSecretHeaderRotationUsesHTTPCaseIdentity(t *testing.T) {
	service, _ := newPluginProviderTestService(t)
	original := pluginProviderTestConfig()
	original.APIKey = "selected-key"
	original.Headers = map[string]string{"Authorization": "original-value"}
	if err := service.AISaveProvider(original); err != nil {
		t.Fatal(err)
	}
	posted := service.AIGetProviders()[0]
	posted.Headers = map[string]string{"authorization": "rotated-value"}
	if err := validatePluginProviderConfig(posted); err != nil {
		t.Fatalf("single posted HTTP header rejected: %v", err)
	}
	if err := service.AISaveProvider(posted); err != nil {
		t.Fatalf("case-only explicit secret override rejected: %v", err)
	}
	snapshot, err := NewProviderConfigStore(service.configDir, service.secretStore).LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	saved := snapshot.Providers[0]
	if saved.APIKey != "selected-key" || !reflect.DeepEqual(saved.Headers, map[string]string{"authorization": "rotated-value"}) {
		t.Fatal("case alias did not rotate exactly one selected header")
	}
}

func TestPluginProviderRedactedHeaderCaseRetainsAndPostedAliasesReject(t *testing.T) {
	service, _ := newPluginProviderTestService(t)
	original := pluginProviderTestConfig()
	original.APIKey = "selected-key"
	original.Headers = map[string]string{"Authorization": "retained-value"}
	if err := service.AISaveProvider(original); err != nil {
		t.Fatal(err)
	}
	posted := service.AIGetProviders()[0]
	posted.Headers = map[string]string{"authorization": ""}
	if err := service.AISaveProvider(posted); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(service.providers[0].Headers, original.Headers) {
		t.Fatal("redacted alias deleted or duplicated an existing secret")
	}
	before, _, err := service.dailySecretStore().GetAIProvider(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	posted.Headers = map[string]string{"Authorization": "one", "authorization": "two"}
	if err := service.AISaveProvider(posted); err == nil {
		t.Fatal("duplicate posted HTTP identities were normalized instead of rejected")
	}
	after, _, err := service.dailySecretStore().GetAIProvider(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("rejected posted duplicates changed encrypted credentials")
	}
}

func TestPluginProviderNilDoesNotCanonicalizeInvalidStoredHeaderAliases(t *testing.T) {
	service, _ := newPluginProviderTestService(t)
	old := pluginProviderTestConfig()
	old.APIKey = "selected-key"
	old.Headers = map[string]string{"Authorization": "old-one", "authorization": "old-two"}
	store := NewProviderConfigStore(service.configDir, service.secretStore)
	if err := store.Save(ProviderConfigStoreSnapshot{Providers: []ai.ProviderConfig{old}, ActiveProvider: old.ID}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	service.providers = snapshot.Providers
	posted := cloneAgentProviderConfig(snapshot.Providers[0])
	posted.APIKey = ""
	posted.Headers = nil
	if err := service.AISaveProvider(posted); err == nil {
		t.Fatal("nil silently normalized unsupported stored aliases")
	}
}
