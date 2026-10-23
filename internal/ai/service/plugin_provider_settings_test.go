package aiservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/ai/safety"
	"GoNavi-Wails/internal/plugin"
	"GoNavi-Wails/internal/secretstore"
	"GoNavi-Wails/shared/i18n"
)

const (
	pluginProviderTestType   = "plugin:test.provider:chat"
	pluginProviderTestKey    = "fixture-plugin-api-key"
	pluginProviderTestHeader = "fixture-plugin-header-secret"
	pluginProviderTestRef    = "oskeyring://gonavi/ai-provider/plugin-setting"
)

type pluginProviderTestSecrets struct {
	secretstore.SecretStore
	calls atomic.Int32
}

func (s *pluginProviderTestSecrets) Put(ref string, payload []byte) error {
	s.calls.Add(1)
	return s.SecretStore.Put(ref, payload)
}

func (s *pluginProviderTestSecrets) Get(ref string) ([]byte, error) {
	s.calls.Add(1)
	return s.SecretStore.Get(ref)
}

func (s *pluginProviderTestSecrets) Delete(ref string) error {
	s.calls.Add(1)
	return s.SecretStore.Delete(ref)
}

func (s *pluginProviderTestSecrets) HealthCheck() error {
	s.calls.Add(1)
	return s.SecretStore.HealthCheck()
}

func newPluginProviderTestService(t *testing.T) (*Service, *pluginProviderTestSecrets) {
	t.Helper()
	secrets := &pluginProviderTestSecrets{SecretStore: secretstore.NewUnavailableStore("test keyring must not be used")}
	return &Service{
		ctx:          context.Background(),
		agentContext: context.Background(),
		providers:    []ai.ProviderConfig{},
		safetyLevel:  ai.PermissionReadOnly,
		contextLevel: ai.ContextSchemaOnly,
		guard:        safety.NewGuard(ai.PermissionReadOnly),
		configDir:    t.TempDir(),
		secretStore:  secrets,
		localizer:    newServiceLocalizer(),
	}, secrets
}

func pluginProviderTestConfig() ai.ProviderConfig {
	return ai.ProviderConfig{
		ID:            "plugin-setting",
		Type:          pluginProviderTestType,
		Name:          "Plugin setting",
		AuthMode:      "api-key",
		Model:         "model-one",
		ContextWindow: 8192,
		Temperature:   0.1,
	}
}

func pluginProviderTestSnapshot() provider.PluginProviderSnapshot {
	return provider.PluginProviderSnapshot{
		Owned: true,
		Statuses: []plugin.Status{{
			Manifest: plugin.Manifest{
				SchemaVersion: 1,
				APIVersion:    1,
				ID:            "test.provider",
				Name:          "Test plugin",
				Version:       "1.0.0",
				Permissions:   []string{"ai.providers"},
				Backend:       &plugin.Backend{Default: &plugin.Entry{Executable: "never-executed"}},
				Contributes: plugin.Contributions{
					Commands: []plugin.Command{{ID: "generate", Title: "Generate"}},
					AIProviders: []plugin.AIProvider{{
						ID:             "chat",
						Name:           "Test",
						Command:        "generate",
						Models:         []plugin.AIModel{{ID: "model-one", Name: "Model", ContextWindow: 32768, MaxOutputTokens: 4096}},
						SupportsTools:  true,
						SupportsImages: false,
					}},
				},
			},
			Digest:         strings.Repeat("a", 64),
			State:          plugin.StateRunning,
			DesiredEnabled: true,
			Generation:     7,
		}},
	}
}

type pluginProviderTestSources struct {
	snapshot     provider.PluginProviderSnapshot
	catalogErr   error
	catalogCalls atomic.Int32
	managerCalls atomic.Int32
}

func (s *pluginProviderTestSources) factory() *provider.PluginFactory {
	return provider.NewPluginFactory(
		func(context.Context) (provider.PluginProviderSnapshot, error) {
			s.catalogCalls.Add(1)
			return s.snapshot, s.catalogErr
		},
		func(context.Context) (*plugin.Manager, error) {
			s.managerCalls.Add(1)
			return nil, errors.New("runtime unavailable: " + pluginProviderTestKey)
		},
	)
}

func configurePluginProviderTestSources(t *testing.T, service *Service, sources *pluginProviderTestSources) *provider.PluginFactory {
	t.Helper()
	factory := sources.factory()
	if err := ConfigurePluginProviderFactory(service, factory); err != nil {
		t.Fatal(err)
	}
	return factory
}

type pluginProviderTestIO struct {
	modelCalls   atomic.Int32
	healthCalls  atomic.Int32
	gatewayCalls atomic.Int32
	httpCalls    atomic.Int32
	url          string
}

func guardPluginProviderTestIO(t *testing.T) *pluginProviderTestIO {
	t.Helper()
	calls := &pluginProviderTestIO{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.httpCalls.Add(1)
		w.WriteHeader(http.StatusTeapot)
	}))
	calls.url = server.URL
	t.Cleanup(server.Close)
	t.Setenv("GONAVI_AI_GATEWAY_URL", server.URL)
	previousFetch, previousGateway := fetchModelsFunc, builtinAIHTTPDo
	previousClaude, previousClaudeAuth := claudeCLIHealthCheckFunc, claudeCLILocalAuthCheckFunc
	previousCodex, previousGrok := codexCLIHealthCheckFunc, grokCLIHealthCheckFunc
	previousCursor, previousCodebuddy := cursorCLIHealthCheckFunc, codebuddyCLIHealthCheckFunc
	fetchModelsFunc = func(ai.ProviderConfig, *i18n.Localizer) ([]string, error) {
		calls.modelCalls.Add(1)
		return nil, errors.New("unexpected model discovery")
	}
	builtinAIHTTPDo = func(*http.Request) (*http.Response, error) {
		calls.gatewayCalls.Add(1)
		return nil, errors.New("unexpected gateway request")
	}
	health := func(ai.ProviderConfig) error {
		calls.healthCalls.Add(1)
		return errors.New("unexpected CLI health check")
	}
	claudeCLIHealthCheckFunc, claudeCLILocalAuthCheckFunc = health, health
	codexCLIHealthCheckFunc, grokCLIHealthCheckFunc = health, health
	cursorCLIHealthCheckFunc, codebuddyCLIHealthCheckFunc = health, health
	t.Cleanup(func() {
		fetchModelsFunc, builtinAIHTTPDo = previousFetch, previousGateway
		claudeCLIHealthCheckFunc, claudeCLILocalAuthCheckFunc = previousClaude, previousClaudeAuth
		codexCLIHealthCheckFunc, grokCLIHealthCheckFunc = previousCodex, previousGrok
		cursorCLIHealthCheckFunc, codebuddyCLIHealthCheckFunc = previousCursor, previousCodebuddy
	})
	return calls
}

func (c *pluginProviderTestIO) assertUnused(t *testing.T) {
	t.Helper()
	if models, health, gateway, httpCalls := c.modelCalls.Load(), c.healthCalls.Load(), c.gatewayCalls.Load(), c.httpCalls.Load(); models != 0 || health != 0 || gateway != 0 || httpCalls != 0 {
		t.Errorf("unexpected IO: models=%d CLI-health=%d gateway=%d HTTP=%d", models, health, gateway, httpCalls)
	}
}

func assertPluginProviderTestNoDisclosure(t *testing.T, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{pluginProviderTestKey, pluginProviderTestHeader, pluginProviderTestRef} {
		if strings.Contains(string(raw), secret) {
			t.Error("public result disclosed a selected provider credential")
		}
	}
}

func assertPluginProviderTestNoFiles(t *testing.T, service *Service) {
	t.Helper()
	entries, err := os.ReadDir(service.configDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("read-only or rejected operation wrote %d config entries", len(entries))
	}
}

func TestPluginProviderSettingsDeclarationOnlyMetadataModelsAndContext(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	service, secrets := newPluginProviderTestService(t)
	sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
	factory := configurePluginProviderTestSources(t, service, sources)
	config := pluginProviderTestConfig()
	config.BaseURL, config.APIKey = ioCalls.url, pluginProviderTestKey
	config.HasSecret, config.SecretRef = true, pluginProviderTestRef
	config.Models, config.CustomModels = []string{"stale-editor-model"}, []string{"undeclared-model"}
	config.Headers = map[string]string{"Authorization": pluginProviderTestHeader, "X-Team": "test"}
	service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID

	catalog, err := factory.Catalog(context.Background())
	if err != nil || len(catalog) != 1 {
		t.Fatalf("declaration catalog: count=%d err=%v", len(catalog), err)
	}
	view := catalog[0]
	if view.Type != config.Type || view.PluginID != "test.provider" || view.ID != "chat" || view.Name != "Test" || !view.Available || !view.SupportsTools || view.SupportsImages {
		t.Fatalf("unexpected declaration identity/capabilities: %+v", view)
	}
	if len(view.Models) != 1 || view.Models[0] != (plugin.AIModel{ID: "model-one", Name: "Model", ContextWindow: 32768, MaxOutputTokens: 4096}) {
		t.Fatalf("models did not come from the declaration: %+v", view.Models)
	}
	if view.Version != "1.0.0" || view.Digest != strings.Repeat("a", 64) || view.Generation != 7 {
		t.Fatal("catalog lost declaration epoch metadata")
	}
	view.Models[0].ID = "caller-mutated"
	again, err := factory.Catalog(context.Background())
	if err != nil || len(again) != 1 || again[0].Models[0].ID != "model-one" {
		t.Fatal("catalog exposed the declaration's mutable model slice")
	}
	providers := service.AIGetProviders()
	if len(providers) != 1 || providers[0].Type != config.Type || providers[0].Model != config.Model || !providers[0].HasSecret || providers[0].SecretRef != config.SecretRef {
		t.Fatal("metadata lost the saved plugin identity or secret reference")
	}
	if providers[0].APIKey != "" || providers[0].Headers["Authorization"] != "" || providers[0].Headers["X-Team"] != "test" {
		t.Fatal("metadata did not redact credentials while retaining ordinary headers")
	}
	for name, result := range map[string]map[string]interface{}{
		"draft":  service.AIListProviderModels(config),
		"active": service.AIListModels(),
	} {
		models, ok := result["models"].([]string)
		if result["success"] != true || result["source"] != "plugin-declaration" || !ok || !slices.Equal(models, []string{"model-one"}) {
			t.Errorf("%s models escaped the declaration: %v", name, result)
		}
		assertPluginProviderTestNoDisclosure(t, result)
	}
	for _, window := range []int{8192, 6144, 65536} {
		config.ContextWindow = window
		profile := service.AIGetModelContextProfile(config)
		want := []int{1024, 2048, 4096, 8192, 16384, 32768}
		if window == 6144 {
			want = []int{1024, 2048, 4096, 6144, 8192, 16384, 32768}
		}
		if profile.DefaultWindow != 32768 || !slices.Equal(profile.Options, want) {
			t.Errorf("context override %d: profile=%+v want=%v", window, profile, want)
		}
	}
	if sources.catalogCalls.Load() == 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
		t.Fatal("metadata did not remain on the catalog-only path")
	}
	ioCalls.assertUnused(t)
	assertPluginProviderTestNoFiles(t, service)
}

func TestPluginProviderSettingsUnavailableContextHasNoBuiltinDefault(t *testing.T) {
	tests := []struct {
		name      string
		kind      string
		configure bool
	}{
		{name: "factory missing"},
		{name: "source unavailable", kind: "error", configure: true},
		{name: "declaration absent", kind: "absent", configure: true},
		{name: "plugin absent", kind: "plugin", configure: true},
		{name: "model absent", kind: "model", configure: true},
		{name: "malformed namespace", kind: "malformed", configure: true},
		{name: "reserved builtin identity", kind: "builtin", configure: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			config := pluginProviderTestConfig()
			config.HasSecret, config.SecretRef = true, pluginProviderTestRef
			sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
			switch test.kind {
			case "error":
				sources.catalogErr = errors.New(pluginProviderTestKey)
			case "absent":
				sources.snapshot.Statuses = nil
			case "plugin":
				config.Type = "plugin:missing.provider:chat"
			case "model":
				config.Model = "unavailable-model"
			case "malformed":
				config.Type = " Plugin:test.provider:chat "
			case "builtin":
				config.ID = builtinAIProviderID
			}
			if test.configure {
				configurePluginProviderTestSources(t, service, sources)
			}
			profile := service.AIGetModelContextProfile(config)
			if profile.DefaultWindow != 0 || profile.DefaultWindow == ai.UnknownModelContextWindow || profile.Options == nil || len(profile.Options) != 0 {
				t.Fatalf("unavailable plugin received a builtin/default profile: %+v", profile)
			}
			if test.kind != "model" {
				result := service.AIListProviderModels(config)
				models, ok := result["models"].([]string)
				if result["success"] != false || !ok || models == nil || len(models) != 0 {
					t.Fatalf("unavailable declaration returned fallback models: %v", result)
				}
				assertPluginProviderTestNoDisclosure(t, result)
			}
			if sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
				t.Fatal("unavailable metadata attempted runtime or keyring access")
			}
			ioCalls.assertUnused(t)
			assertPluginProviderTestNoFiles(t, service)
		})
	}
}

func TestPluginProviderSettingsDisabledModelsFailAndPreserveIdentity(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	service, secrets := newPluginProviderTestService(t)
	snapshot := pluginProviderTestSnapshot()
	snapshot.Statuses[0].DesiredEnabled, snapshot.Statuses[0].State = false, plugin.StateDisabled
	sources := &pluginProviderTestSources{snapshot: snapshot}
	factory := configurePluginProviderTestSources(t, service, sources)
	config := pluginProviderTestConfig()
	config.HasSecret, config.SecretRef = true, pluginProviderTestRef
	service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
	for _, result := range []map[string]interface{}{service.AIListModels(), service.AIListProviderModels(config)} {
		models, ok := result["models"].([]string)
		if result["success"] != false || result["source"] != "plugin-declaration" || !ok || !slices.Equal(models, []string{"model-one"}) {
			t.Fatalf("disabled provider lost its static declaration or claimed availability: %v", result)
		}
		assertPluginProviderTestNoDisclosure(t, result)
	}
	catalog, err := factory.Catalog(context.Background())
	if err != nil || len(catalog) != 1 || catalog[0].Available || catalog[0].Reason != "disabled" || catalog[0].Type != config.Type {
		t.Fatalf("disabled catalog entry was rewritten or removed: %+v err=%v", catalog, err)
	}
	providers := service.AIGetProviders()
	if len(providers) != 1 || providers[0].ID != config.ID || providers[0].Type != config.Type || providers[0].Model != config.Model || providers[0].SecretRef != config.SecretRef || !providers[0].HasSecret {
		t.Fatal("disabled saved provider identity/secret reference changed")
	}
	if service.AIGetActiveProvider() != config.ID || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
		t.Fatal("disabled metadata changed the active provider or accessed runtime secrets")
	}
	ioCalls.assertUnused(t)
	assertPluginProviderTestNoFiles(t, service)
}

func pluginProviderTestNamespaceCases() []string {
	return []string{
		pluginProviderTestType, "plugin", "PLUGIN", " plugin ", "plugin:",
		"plugin:test.provider", "plugin:test.provider:", "plugin::chat",
		"plugin:test.provider:chat:extra", "Plugin:test.provider:chat",
		"plugin:Test.provider:chat", "plugin:test.provider:Chat",
		" plugin:test.provider:chat", "plugin:test.provider:chat ",
		"plugin :test.provider:chat",
	}
}

func TestPluginProviderSettingsNamespaceNeverFallsBackToHTTPModels(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	localizer := newServiceLocalizer()
	for _, namespace := range pluginProviderTestNamespaceCases() {
		t.Run(namespace, func(t *testing.T) {
			config := pluginProviderTestConfig()
			config.Type, config.BaseURL, config.APIKey = namespace, ioCalls.url, pluginProviderTestKey
			config.Models, config.CustomModels = []string{"configured-fallback"}, []string{"custom-fallback"}
			config.HasSecret, config.SecretRef = true, pluginProviderTestRef
			if !isPluginProviderConfig(config) {
				t.Fatal("plugin-like namespace escaped its guard")
			}
			if got := resolveModelsURL(config); got != "" {
				t.Errorf("plugin namespace resolved an HTTP model endpoint: %q", got)
			}
			if request, err := newModelsRequest(config, localizer); err == nil || request != nil {
				t.Fatal("plugin namespace created an HTTP model request")
			}
			for _, fallback := range []bool{false, true} {
				result := listProviderModels(config, localizer, fallback)
				models, ok := result["models"].([]string)
				if result["success"] != false || !ok || len(models) != 0 {
					t.Errorf("plugin namespace used a configured/API fallback: %v", result)
				}
				assertPluginProviderTestNoDisclosure(t, result)
			}
			if models, err := fetchModels(config, localizer); err == nil || len(models) != 0 {
				t.Errorf("direct model fetch did not fail closed: count=%d err=%v", len(models), err)
			}
		})
	}
	ioCalls.assertUnused(t)
}

func TestPluginProviderSettingsMissingPluginSaveIsStaticAndKeepsSecretSemantics(t *testing.T) {
	for _, withSecret := range []bool{false, true} {
		name := "without secret"
		if withSecret {
			name = "with selected secret"
		}
		t.Run(name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			sources := &pluginProviderTestSources{}
			configurePluginProviderTestSources(t, service, sources)
			config := pluginProviderTestConfig()
			config.Type, config.Model = "plugin:missing.provider:chat", "unavailable-model"
			config.Models, config.MaxTokens = []string{"stale-editor-model"}, 2048
			config.SecretRef = pluginProviderTestRef
			config.Headers = map[string]string{"X-Team": "test"}
			if withSecret {
				config.APIKey, config.HasSecret = pluginProviderTestKey, true
				config.Headers["Authorization"] = pluginProviderTestHeader
			}
			prepared, err := service.preparePluginProviderSave(config)
			if err != nil || !reflect.DeepEqual(prepared, config) {
				t.Fatal("static preparation rewrote the missing plugin or its secret reference")
			}
			if err := service.AISaveProvider(config); err != nil {
				t.Fatalf("static missing-plugin save: %v", err)
			}
			assertPluginProviderTestSavedConfig(t, service, config, withSecret)
			public := service.AIGetProviders()[0]
			public.SecretRef = pluginProviderTestRef
			if err := service.AISaveProvider(public); err != nil {
				t.Fatalf("secret-preserving metadata save: %v", err)
			}
			assertPluginProviderTestSavedConfig(t, service, config, withSecret)
			reloaded, reloadSecrets := newPluginProviderTestService(t)
			reloaded.configDir = service.configDir
			if err := reloaded.loadConfig(); err != nil {
				t.Fatal(err)
			}
			assertPluginProviderTestSavedConfig(t, reloaded, config, withSecret)
			if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 || reloadSecrets.calls.Load() != 0 {
				t.Fatal("static save/load accessed plugin metadata, runtime, or keyring")
			}
			ioCalls.assertUnused(t)
		})
	}
}

func assertPluginProviderTestSavedConfig(t *testing.T, service *Service, want ai.ProviderConfig, withSecret bool) {
	t.Helper()
	providers := service.AIGetProviders()
	if len(providers) != 1 {
		t.Fatalf("saved provider count=%d", len(providers))
	}
	got := providers[0]
	if got.ID != want.ID || got.Type != want.Type || got.Model != want.Model || got.ContextWindow != 8192 {
		t.Fatal("save/load rewrote plugin identity, model, or selected context")
	}
	if got.Models != nil || got.MaxTokens != 0 || got.SecretRef != "" || got.HasSecret != withSecret || got.APIKey != "" || got.Headers["Authorization"] != "" {
		t.Fatal("save/load changed removed editor fields or daily-secret metadata semantics")
	}
	editable, err := service.AIGetEditableProvider(want.ID)
	if err != nil {
		t.Fatal(err)
	}
	if withSecret && (editable.APIKey != pluginProviderTestKey || editable.Headers["Authorization"] != pluginProviderTestHeader) {
		t.Fatal("metadata-only save lost the existing selected credential")
	}
	if !withSecret && (editable.HasSecret || editable.SecretRef != "" || editable.APIKey != "") {
		t.Fatal("a stale secret reference created a credential")
	}
	raw, err := os.ReadFile(filepath.Join(service.configDir, aiConfigFileName))
	if err != nil {
		t.Fatal(err)
	}
	assertPluginProviderTestNoDisclosure(t, json.RawMessage(raw))
	var stored aiConfig
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Providers) != 1 || stored.Providers[0].Type != want.Type || stored.Providers[0].Model != want.Model || stored.Providers[0].ContextWindow != 8192 || stored.Providers[0].Models != nil || stored.Providers[0].MaxTokens != 0 {
		t.Fatal("persisted plugin identity/context or removed editor fields differ from the public view")
	}
}

func pluginProviderTestJSON(t *testing.T, config ai.ProviderConfig, pin bool) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if !pin {
		return raw
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	runtime, err := json.Marshal(map[string]any{
		"pluginId": "test.provider", "providerId": "chat", "version": "1.0.0",
		"digest": strings.Repeat("a", 64), "generation": 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	object["_pluginRuntime"] = runtime
	raw, err = json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPluginProviderSettingsOrdinaryDTOCannotPersistRuntimePin(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	service, secrets := newPluginProviderTestService(t)
	sources := &pluginProviderTestSources{}
	configurePluginProviderTestSources(t, service, sources)
	var ordinary ai.ProviderConfig
	if err := json.Unmarshal(pluginProviderTestJSON(t, pluginProviderTestConfig(), true), &ordinary); err != nil {
		t.Fatal(err)
	}
	if err := service.AISaveProvider(ordinary); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{ordinary, service.AIGetProviders()} {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "_pluginRuntime") {
			t.Fatal("ordinary provider DTO retained host-only runtime authority")
		}
	}
	raw, err := os.ReadFile(filepath.Join(service.configDir, aiConfigFileName))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "_pluginRuntime") {
		t.Fatal("ordinary DTO persisted a user-supplied runtime pin")
	}
	if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
		t.Fatal("ordinary DTO save attempted runtime or keyring access")
	}
	ioCalls.assertUnused(t)
}

type pluginProviderTestInvalidCase struct {
	name   string
	mutate func(*ai.ProviderConfig)
}

func pluginProviderTestInvalidCases() []pluginProviderTestInvalidCase {
	tests := make([]pluginProviderTestInvalidCase, 0, 32)
	for _, namespace := range pluginProviderTestNamespaceCases()[1:] {
		tests = append(tests, pluginProviderTestInvalidCase{
			name: "namespace " + namespace,
			mutate: func(config *ai.ProviderConfig) {
				config.Type = namespace
			},
		})
	}
	return append(tests,
		pluginProviderTestInvalidCase{name: "foreign API format", mutate: func(c *ai.ProviderConfig) { c.APIFormat = "openai" }},
		pluginProviderTestInvalidCase{name: "foreign CLI format", mutate: func(c *ai.ProviderConfig) { c.APIFormat = "claude-cli" }},
		pluginProviderTestInvalidCase{name: "foreign CLI path", mutate: func(c *ai.ProviderConfig) { c.CLIPath = "must-not-run" }},
		pluginProviderTestInvalidCase{name: "foreign CLI environment", mutate: func(c *ai.ProviderConfig) { c.CLIEnv = map[string]string{"OPENAI_API_KEY": pluginProviderTestKey} }},
		pluginProviderTestInvalidCase{name: "foreign effort", mutate: func(c *ai.ProviderConfig) { c.Effort = "high" }},
		pluginProviderTestInvalidCase{name: "foreign thinking", mutate: func(c *ai.ProviderConfig) { c.ThinkingIntensity = "high" }},
		pluginProviderTestInvalidCase{name: "foreign header timeout", mutate: func(c *ai.ProviderConfig) { c.HeaderTimeoutSeconds = 1 }},
		pluginProviderTestInvalidCase{name: "foreign bearer auth", mutate: func(c *ai.ProviderConfig) { c.AuthMode = "bearer" }},
		pluginProviderTestInvalidCase{name: "foreign local CLI auth", mutate: func(c *ai.ProviderConfig) { c.AuthMode = "local-cli" }},
		pluginProviderTestInvalidCase{name: "builtin ID", mutate: func(c *ai.ProviderConfig) { c.ID = builtinAIProviderID }},
		pluginProviderTestInvalidCase{name: "builtin ID case", mutate: func(c *ai.ProviderConfig) { c.ID = "GONAVI-AI" }},
		pluginProviderTestInvalidCase{name: "builtin ID whitespace", mutate: func(c *ai.ProviderConfig) { c.ID = " gonavi-ai " }},
	)
}

func TestPluginProviderSettingsRejectInvalidBeforeFactoryHealthAndGateway(t *testing.T) {
	for _, test := range pluginProviderTestInvalidCases() {
		t.Run(test.name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
			configurePluginProviderTestSources(t, service, sources)
			config := pluginProviderTestConfig()
			config.BaseURL, config.APIKey = ioCalls.url, pluginProviderTestKey
			config.HasSecret, config.SecretRef = true, pluginProviderTestRef
			config.Headers = map[string]string{"Authorization": pluginProviderTestHeader}
			test.mutate(&config)
			if !isPluginProviderConfig(config) || isBuiltinAIProviderConfig(config) {
				t.Fatal("invalid plugin was classified as an ordinary/builtin provider")
			}
			if normalizedProviderType(config) != config.Type || !reflect.DeepEqual(normalizeProviderConfig(config), config) || !reflect.DeepEqual(normalizeBuiltinAIProviderConfig(config), config) {
				t.Fatal("normalization repaired or downgraded the raw plugin configuration")
			}
			if err := validatePluginProviderConfig(config); err == nil {
				t.Fatal("static validation accepted an invalid plugin")
			}
			if err := service.AISaveProvider(config); err == nil {
				t.Error("invalid plugin save succeeded")
			} else {
				assertPluginProviderTestNoDisclosure(t, err.Error())
			}
			result := service.AITestProvider(config)
			if result["success"] != false || result["modelVerified"] != false || result["checkKind"] != "model-response" {
				t.Errorf("invalid plugin health result: %v", result)
			}
			assertPluginProviderTestNoDisclosure(t, result)
			if instance, err := service.newPluginProvider(context.Background(), config); err == nil || instance != nil {
				t.Error("invalid plugin acquired a runtime provider")
			}
			service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
			if instance, _, err := service.getActiveProviderRuntimeWithContext(context.Background(), ai.ChatSendOptions{}); err == nil || instance != nil {
				t.Error("invalid active plugin acquired a runtime provider")
			}
			input := runharness.AgentInputRequest{Provider: config.ID}
			if err := service.bindAgentProviderInput(context.Background(), &input); err == nil {
				t.Error("invalid plugin acquired an Agent binding")
			}
			if _, ok := input.ProviderBindingForHost(); ok {
				t.Error("rejected input retained a provider binding")
			}
			binding, err := runharness.NewProviderBinding(config.ID, config)
			if err != nil {
				t.Fatal(err)
			}
			if instance, err := service.resolveAgentProvider(context.Background(), runharness.ModelTurnRequest{Provider: binding.ProviderID, ProviderBinding: &binding}); err == nil || instance != nil {
				t.Error("invalid frozen plugin configuration acquired an Agent provider")
			}
			if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
				t.Fatal("invalid plugin reached factory callbacks or keyring")
			}
			ioCalls.assertUnused(t)
			assertPluginProviderTestNoFiles(t, service)
		})
	}
}

func TestPluginProviderSettingsStoredInvalidRetainsRawIdentityForCorrection(t *testing.T) {
	for _, test := range pluginProviderTestInvalidCases() {
		t.Run(test.name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
			configurePluginProviderTestSources(t, service, sources)
			config := pluginProviderTestConfig()
			config.BaseURL, config.APIKey = ioCalls.url, pluginProviderTestKey
			config.HasSecret, config.SecretRef = true, pluginProviderTestRef
			config.Models, config.MaxTokens = []string{"old-editor-model"}, 2048
			test.mutate(&config)
			raw, err := json.Marshal(aiConfig{SchemaVersion: aiConfigSchemaVersion - 1, Providers: []ai.ProviderConfig{config}, ActiveProvider: config.ID})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(service.configDir, aiConfigFileName), raw, 0o600); err != nil {
				t.Fatal(err)
			}
			store := NewProviderConfigStore(service.configDir, secrets)
			snapshot, err := store.Load()
			if err != nil || len(snapshot.Providers) != 1 {
				t.Fatalf("load legacy plugin: count=%d err=%v", len(snapshot.Providers), err)
			}
			assertPluginProviderTestRawConfig(t, snapshot.Providers[0], config)
			if snapshot.Providers[0].APIKey != pluginProviderTestKey || snapshot.Providers[0].SecretRef != "" || !snapshot.Providers[0].HasSecret || !reflect.DeepEqual(snapshot.Providers[0].CLIEnv, config.CLIEnv) {
				t.Fatal("legacy plugin load lost selected secrets or foreign CLI fields")
			}
			if err := service.loadConfig(); err != nil {
				t.Fatal(err)
			}
			providers := service.AIGetProviders()
			if len(providers) != 1 || service.AIGetActiveProvider() != config.ID {
				t.Fatal("service load removed or remapped the invalid plugin")
			}
			assertPluginProviderTestRawConfig(t, providers[0], config)
			if providers[0].APIKey != "" || len(providers[0].CLIEnv) != 0 || !providers[0].HasSecret {
				t.Fatal("public invalid-provider metadata failed to redact selected secrets")
			}
			rewritten, err := os.ReadFile(filepath.Join(service.configDir, aiConfigFileName))
			if err != nil {
				t.Fatal(err)
			}
			assertPluginProviderTestNoDisclosure(t, json.RawMessage(rewritten))
			var persisted aiConfig
			if err := json.Unmarshal(rewritten, &persisted); err != nil {
				t.Fatal(err)
			}
			if len(persisted.Providers) != 1 {
				t.Fatal("legacy rewrite changed the provider count")
			}
			assertPluginProviderTestRawConfig(t, persisted.Providers[0], config)
			if err := service.AISaveProvider(config); err == nil {
				t.Fatal("retaining a stored invalid record incorrectly authorized an invalid editor save")
			}
			if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
				t.Fatal("legacy plugin load/correction accessed runtime or keyring")
			}
			ioCalls.assertUnused(t)
		})
	}
}

func assertPluginProviderTestRawConfig(t *testing.T, got, want ai.ProviderConfig) {
	t.Helper()
	if got.ID != want.ID || got.Type != want.Type || got.Name != want.Name || got.Model != want.Model || got.BaseURL != want.BaseURL || got.ContextWindow != 8192 {
		t.Fatal("stored invalid plugin identity/model/context was normalized to another provider")
	}
	if got.APIFormat != want.APIFormat || got.AuthMode != want.AuthMode || got.CLIPath != want.CLIPath || got.ThinkingIntensity != want.ThinkingIntensity || got.Effort != want.Effort || got.HeaderTimeoutSeconds != want.HeaderTimeoutSeconds || !reflect.DeepEqual(got.SupportsImages, want.SupportsImages) {
		t.Fatal("stored foreign plugin fields were silently normalized")
	}
	if got.Models != nil || got.MaxTokens != 0 {
		t.Fatal("legacy store did not clear exactly the removed Models/MaxTokens editor fields")
	}
}
