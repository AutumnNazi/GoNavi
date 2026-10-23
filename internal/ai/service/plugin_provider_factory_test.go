package aiservice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginProviderFactoryConfigurationIsPerServiceAndOnce(t *testing.T) {
	first, _ := newPluginProviderTestService(t)
	second, _ := newPluginProviderTestService(t)
	firstSources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
	secondSnapshot := pluginProviderTestSnapshot()
	secondSnapshot.Statuses[0].Manifest.Contributes.AIProviders[0].Models[0].ContextWindow = 16384
	secondSources := &pluginProviderTestSources{snapshot: secondSnapshot}
	firstFactory, secondFactory := firstSources.factory(), secondSources.factory()

	if err := ConfigurePluginProviderFactory(nil, firstFactory); err == nil {
		t.Error("nil service accepted plugin integration")
	}
	if err := ConfigurePluginProviderFactory(first, nil); err == nil {
		t.Error("nil factory accepted plugin integration")
	}
	if err := ConfigurePluginProviderFactory(first, firstFactory); err != nil {
		t.Fatal(err)
	}
	if err := ConfigurePluginProviderFactory(first, firstFactory); err != nil {
		t.Fatalf("same-pointer configuration was not idempotent: %v", err)
	}
	if err := ConfigurePluginProviderFactory(first, secondFactory); err == nil {
		t.Error("a different factory replaced an already configured factory")
	}
	if err := ConfigurePluginProviderFactory(first, nil); err == nil {
		t.Error("nil factory cleared an already configured factory")
	}
	if got, err := first.pluginProviderFactory(); err != nil || got != firstFactory {
		t.Fatal("rejected reconfiguration changed the first service's factory")
	}
	if got, err := second.pluginProviderFactory(); err == nil || got != nil {
		t.Fatal("configuring the first service configured another service globally")
	}
	if err := ConfigurePluginProviderFactory(second, secondFactory); err != nil {
		t.Fatal(err)
	}
	config := pluginProviderTestConfig()
	if got := first.AIGetModelContextProfile(config).DefaultWindow; got != 32768 {
		t.Fatalf("first service used another factory's declaration: %d", got)
	}
	if got := second.AIGetModelContextProfile(config).DefaultWindow; got != 16384 {
		t.Fatalf("second service used another factory's declaration: %d", got)
	}
	if got, err := second.pluginProviderFactory(); err != nil || got != secondFactory {
		t.Fatal("second service did not retain its own factory")
	}
	if firstSources.catalogCalls.Load() != 1 || secondSources.catalogCalls.Load() != 1 || firstSources.managerCalls.Load() != 0 || secondSources.managerCalls.Load() != 0 {
		t.Fatal("per-service metadata crossed factories or acquired runtime authority")
	}
}

func TestPluginProviderFactoryMissingIntegrationFailsWithoutDefaultFallback(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	service, secrets := newPluginProviderTestService(t)
	otherService, _ := newPluginProviderTestService(t)
	otherSources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
	configurePluginProviderTestSources(t, otherService, otherSources)
	config := pluginProviderTestConfig()
	config.BaseURL, config.APIKey = ioCalls.url, pluginProviderTestKey
	service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID

	for name, candidate := range map[string]*Service{"nil service": nil, "unconfigured service": service} {
		factory, err := candidate.pluginProviderFactory()
		if err == nil || factory != nil || !strings.Contains(err.Error(), "plugin provider integration is unavailable") {
			t.Errorf("%s did not report unavailable integration: %v", name, err)
		}
	}
	if instance, err := service.newPluginProvider(context.Background(), config); err == nil || instance != nil || !strings.Contains(err.Error(), "integration is unavailable") {
		t.Errorf("missing integration acquired a default provider: %v", err)
	}
	if instance, _, err := service.getActiveProviderRuntimeWithContext(context.Background(), ai.ChatSendOptions{}); err == nil || instance != nil || !strings.Contains(err.Error(), "integration is unavailable") {
		t.Errorf("active plugin acquired a default provider: %v", err)
	}
	input := runharness.AgentInputRequest{Provider: config.ID}
	if err := service.bindAgentProviderInput(context.Background(), &input); err == nil || !strings.Contains(err.Error(), "integration is unavailable") {
		t.Errorf("Agent bind did not report missing integration: %v", err)
	}
	if _, ok := input.ProviderBindingForHost(); ok {
		t.Error("failed plugin bind attached a fallback provider binding")
	}
	binding, err := runharness.NewProviderBinding(config.ID, config)
	if err != nil {
		t.Fatal(err)
	}
	if instance, err := service.resolveAgentProvider(context.Background(), runharness.ModelTurnRequest{Provider: config.ID, ProviderBinding: &binding}); err == nil || instance != nil || !strings.Contains(err.Error(), "integration is unavailable") {
		t.Errorf("Agent resolver acquired a default provider: %v", err)
	}
	if instance, err := provider.NewProvider(config); !errors.Is(err, provider.ErrPluginProviderUnavailable) || instance != nil {
		t.Errorf("ordinary provider constructor bypassed instance integration: %v", err)
	}
	result := service.AITestProvider(config)
	if result["success"] != false || result["modelVerified"] != false || result["checkKind"] != "model-response" {
		t.Errorf("missing integration reported a healthy model: %v", result)
	}
	assertPluginProviderTestNoDisclosure(t, result)
	models := service.AIListProviderModels(config)
	if models["success"] != false {
		t.Error("missing integration discovered fallback models")
	}
	if otherSources.catalogCalls.Load() != 0 || otherSources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
		t.Fatal("unconfigured service borrowed another service's factory or keyring")
	}
	ioCalls.assertUnused(t)
	assertPluginProviderTestNoFiles(t, service)
}

func TestPluginProviderFactoryMetadataAvailableWithoutOwnedManagerIsNotHealthy(t *testing.T) {
	tests := []struct {
		name    string
		manager *plugin.Manager
		err     error
	}{
		{name: "manager callback unavailable", err: errors.New(pluginProviderTestKey + " " + pluginProviderTestHeader)},
		{name: "nil manager"},
		{name: "manager without runtime ownership", manager: &plugin.Manager{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			config := pluginProviderTestConfig()
			config.BaseURL, config.APIKey = ioCalls.url, pluginProviderTestKey
			var catalogCalls, managerCalls int
			factory := provider.NewPluginFactory(
				func(context.Context) (provider.PluginProviderSnapshot, error) {
					catalogCalls++
					return pluginProviderTestSnapshot(), nil
				},
				func(context.Context) (*plugin.Manager, error) {
					managerCalls++
					return test.manager, test.err
				},
			)
			if err := ConfigurePluginProviderFactory(service, factory); err != nil {
				t.Fatal(err)
			}
			service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
			if err := provider.ValidatePluginConfig(config); err != nil {
				t.Fatalf("fixture is not statically valid: %v", err)
			}
			catalog, err := factory.Catalog(context.Background())
			if err != nil || len(catalog) != 1 || !catalog[0].Available {
				t.Fatal("fixture must have available declaration metadata")
			}
			if result := service.AIListModels(); result["success"] != true || result["source"] != "plugin-declaration" {
				t.Fatalf("static model listing unnecessarily required a manager: %v", result)
			}
			catalogBeforeHealth := catalogCalls
			result := service.AITestProvider(config)
			if result["success"] != false || result["modelVerified"] != false || result["checkKind"] != "model-response" {
				t.Fatalf("Validate-only or metadata availability became model health: %v", result)
			}
			if message, ok := result["message"].(string); !ok || strings.TrimSpace(message) == "" {
				t.Error("unavailable runtime health failure has no public explanation")
			}
			assertPluginProviderTestNoDisclosure(t, result)
			if managerCalls != 1 || catalogCalls != catalogBeforeHealth || secrets.calls.Load() != 0 {
				t.Errorf("health did not attempt exactly the owned-manager path: manager=%d catalog=%d", managerCalls, catalogCalls-catalogBeforeHealth)
			}
			ioCalls.assertUnused(t)
			assertPluginProviderTestNoFiles(t, service)
		})
	}
}

func TestPluginProviderFactoryRejectsInvalidConfigBeforeSourceCallbacks(t *testing.T) {
	for _, test := range pluginProviderTestInvalidCases() {
		t.Run(test.name, func(t *testing.T) {
			sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
			factory := sources.factory()
			config := pluginProviderTestConfig()
			config.APIKey, config.SecretRef = pluginProviderTestKey, pluginProviderTestRef
			test.mutate(&config)
			if err := provider.ValidatePluginConfig(config); !errors.Is(err, provider.ErrPluginProviderConfig) {
				t.Fatalf("static domain validation accepted invalid config: %v", err)
			}
			if raw, err := factory.Bind(context.Background(), config); !errors.Is(err, provider.ErrPluginProviderConfig) || raw != nil {
				t.Errorf("invalid config reached binding: %v", err)
			}
			if instance, err := factory.New(context.Background(), config); !errors.Is(err, provider.ErrPluginProviderConfig) || instance != nil {
				t.Errorf("invalid config acquired a provider: %v", err)
			}
			if instance, err := factory.Resolve(context.Background(), pluginProviderTestJSON(t, config, true)); !errors.Is(err, provider.ErrPluginProviderConfig) || instance != nil {
				t.Errorf("invalid frozen config acquired a provider: %v", err)
			}
			if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 {
				t.Fatal("static config rejection reached a factory source")
			}
		})
	}
}

func TestPluginProviderFactoryResolveRejectsOrdinaryDTOWithoutPin(t *testing.T) {
	sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
	factory := sources.factory()
	raw := pluginProviderTestJSON(t, pluginProviderTestConfig(), true)
	var ordinary ai.ProviderConfig
	if err := json.Unmarshal(raw, &ordinary); err != nil {
		t.Fatal(err)
	}
	if instance, err := factory.Resolve(context.Background(), pluginProviderTestJSON(t, ordinary, false)); !errors.Is(err, provider.ErrPluginProviderConfig) || instance != nil {
		t.Errorf("ordinary DTO was rebound using current runtime authority: %v", err)
	}
	if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 {
		t.Fatal("unpinned DTO consulted a runtime or declaration source")
	}
}

func TestPluginProviderFactoryCancellationPrecedesSourceCallbacks(t *testing.T) {
	tests := []struct {
		name string
		kind string
	}{
		{name: "nil context", kind: "nil"},
		{name: "canceled context", kind: "cancel"},
		{name: "expired deadline", kind: "deadline"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
			factory := configurePluginProviderTestSources(t, service, sources)
			config := pluginProviderTestConfig()
			config.APIKey = pluginProviderTestKey
			service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
			raw := pluginProviderTestJSON(t, config, true)
			binding, err := runharness.NewProviderBinding(config.ID, raw)
			if err != nil {
				t.Fatal(err)
			}
			var ctx context.Context
			var want error
			if test.kind == "cancel" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(context.Background())
				cancel()
				want = context.Canceled
			} else if test.kind == "deadline" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				defer cancel()
				want = context.DeadlineExceeded
			}
			operations := pluginProviderTestContextOperations(t, service, factory, config, raw, binding)
			for name, operation := range operations {
				t.Run(name, func(t *testing.T) {
					err := operation(ctx)
					if err == nil || (want != nil && !errors.Is(err, want)) {
						t.Errorf("context boundary did not preserve %v: %v", want, err)
					}
				})
			}
			if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
				t.Fatal("nil/canceled/deadline context reached runtime sources or keyring")
			}
			ioCalls.assertUnused(t)
			assertPluginProviderTestNoFiles(t, service)
		})
	}
}

func pluginProviderTestContextOperations(t *testing.T, service *Service, factory *provider.PluginFactory, config ai.ProviderConfig, raw json.RawMessage, binding runharness.ProviderBinding) map[string]func(context.Context) error {
	t.Helper()
	return map[string]func(context.Context) error{
		"factory Catalog": func(ctx context.Context) error {
			_, err := factory.Catalog(ctx)
			return err
		},
		"factory Bind": func(ctx context.Context) error {
			result, err := factory.Bind(ctx, config)
			if err != nil && result != nil {
				t.Error("failed Bind returned a payload")
			}
			return err
		},
		"factory Resolve": func(ctx context.Context) error {
			result, err := factory.Resolve(ctx, raw)
			if err != nil && result != nil {
				t.Error("failed Resolve returned a provider")
			}
			return err
		},
		"factory New": func(ctx context.Context) error {
			result, err := factory.New(ctx, config)
			if err != nil && result != nil {
				t.Error("failed New returned a provider")
			}
			return err
		},
		"service new plugin provider": func(ctx context.Context) error {
			_, err := service.newPluginProvider(ctx, config)
			return err
		},
		"service active runtime": func(ctx context.Context) error {
			_, _, err := service.getActiveProviderRuntimeWithContext(ctx, ai.ChatSendOptions{})
			return err
		},
		"service Agent bind": func(ctx context.Context) error {
			input := runharness.AgentInputRequest{Provider: config.ID}
			err := service.bindAgentProviderInput(ctx, &input)
			if _, ok := input.ProviderBindingForHost(); ok {
				t.Error("failed Agent bind returned a provider binding")
			}
			return err
		},
		"service Agent resolve": func(ctx context.Context) error {
			_, err := service.resolveAgentProvider(ctx, runharness.ModelTurnRequest{Provider: config.ID, ProviderBinding: &binding})
			return err
		},
	}
}

func TestPluginProviderFactoryCallerContextReachesAndCancelsSources(t *testing.T) {
	for _, operationName := range []string{
		"factory Catalog", "factory Bind", "factory Resolve", "factory New",
		"service new plugin provider", "service active runtime", "service Agent bind", "service Agent resolve",
	} {
		t.Run(operationName, func(t *testing.T) {
			ioCalls := guardPluginProviderTestIO(t)
			service, secrets := newPluginProviderTestService(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var catalogCalls, managerCalls int
			factory := provider.NewPluginFactory(
				func(received context.Context) (provider.PluginProviderSnapshot, error) {
					catalogCalls++
					if received != ctx {
						t.Error("catalog callback did not receive the caller's context")
					}
					cancel()
					return pluginProviderTestSnapshot(), nil
				},
				func(received context.Context) (*plugin.Manager, error) {
					managerCalls++
					if received != ctx {
						t.Error("manager callback did not receive the caller's context")
					}
					cancel()
					return nil, errors.New("unavailable runtime: " + pluginProviderTestKey)
				},
			)
			if err := ConfigurePluginProviderFactory(service, factory); err != nil {
				t.Fatal(err)
			}
			config := pluginProviderTestConfig()
			config.APIKey = pluginProviderTestKey
			service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
			raw := pluginProviderTestJSON(t, config, true)
			binding, err := runharness.NewProviderBinding(config.ID, raw)
			if err != nil {
				t.Fatal(err)
			}
			operation := pluginProviderTestContextOperations(t, service, factory, config, raw, binding)[operationName]
			if err := operation(ctx); !errors.Is(err, context.Canceled) {
				t.Errorf("source cancellation was replaced by availability/success: %v", err)
			}
			wantCatalog, wantManager := 0, 1
			if operationName == "factory Catalog" {
				wantCatalog, wantManager = 1, 0
			}
			if catalogCalls != wantCatalog || managerCalls != wantManager || secrets.calls.Load() != 0 {
				t.Errorf("unexpected source calls: catalog=%d manager=%d", catalogCalls, managerCalls)
			}
			ioCalls.assertUnused(t)
			assertPluginProviderTestNoFiles(t, service)
		})
	}
}

func TestPluginProviderFactoryCanceledLifecycleFailsPublicSettingsCalls(t *testing.T) {
	ioCalls := guardPluginProviderTestIO(t)
	service, secrets := newPluginProviderTestService(t)
	sources := &pluginProviderTestSources{snapshot: pluginProviderTestSnapshot()}
	configurePluginProviderTestSources(t, service, sources)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service.agentContext = ctx
	config := pluginProviderTestConfig()
	config.APIKey = pluginProviderTestKey
	service.providers, service.activeProvider = []ai.ProviderConfig{config}, config.ID
	for _, result := range []map[string]interface{}{service.AIListModels(), service.AIListProviderModels(config)} {
		models, ok := result["models"].([]string)
		if result["success"] != false || !ok || len(models) != 0 {
			t.Errorf("canceled lifecycle discovered models: %v", result)
		}
		assertPluginProviderTestNoDisclosure(t, result)
	}
	profile := service.AIGetModelContextProfile(config)
	if profile.DefaultWindow != 0 || profile.Options == nil || len(profile.Options) != 0 {
		t.Errorf("canceled lifecycle returned a fallback profile: %+v", profile)
	}
	result := service.AITestProvider(config)
	if result["success"] != false || result["modelVerified"] != false || result["checkKind"] != "model-response" {
		t.Errorf("canceled lifecycle reported model health: %v", result)
	}
	assertPluginProviderTestNoDisclosure(t, result)
	if sources.catalogCalls.Load() != 0 || sources.managerCalls.Load() != 0 || secrets.calls.Load() != 0 {
		t.Fatal("canceled lifecycle reached catalog/runtime sources or keyring")
	}
	ioCalls.assertUnused(t)
	assertPluginProviderTestNoFiles(t, service)
}
