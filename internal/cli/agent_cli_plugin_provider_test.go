package cli

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func cliPluginProviderConfig() ai.ProviderConfig {
	return ai.ProviderConfig{ID: "native", Type: "plugin:test.providers:text", Name: "Native",
		Model: "test-model", ContextWindow: 4096, MaxTokens: 256, Temperature: 0.25}
}

func TestCLIPluginProviderRejectsForeignConfigBeforeFactory(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*ai.ProviderConfig)
	}{
		{"case identity", func(c *ai.ProviderConfig) { c.Type = "Plugin:test.providers:text" }},
		{"space identity", func(c *ai.ProviderConfig) { c.Type += " " }},
		{"bare namespace", func(c *ai.ProviderConfig) { c.Type = "plugin" }},
		{"malformed identity", func(c *ai.ProviderConfig) { c.Type = "plugin:test.providers" }},
		{"reserved builtin ID", func(c *ai.ProviderConfig) { c.ID = "gonavi-ai" }},
		{"API format", func(c *ai.ProviderConfig) { c.APIFormat = "openai" }},
		{"CLI path", func(c *ai.ProviderConfig) { c.CLIPath = "provider" }},
		{"CLI env", func(c *ai.ProviderConfig) { c.CLIEnv = map[string]string{"ENV": "value"} }},
		{"effort", func(c *ai.ProviderConfig) { c.Effort = "low" }},
		{"thinking", func(c *ai.ProviderConfig) { c.ThinkingIntensity = "off" }},
		{"auth", func(c *ai.ProviderConfig) { c.AuthMode = "bearer" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := cliPluginProviderConfig()
			test.mutate(&config)
			resolver := newCLIProviderResolverState(t.TempDir())
			resolver.plugins = provider.NewPluginFactory(
				func(context.Context) (provider.PluginProviderSnapshot, error) {
					t.Fatal("invalid configuration reached metadata lookup")
					return provider.PluginProviderSnapshot{}, nil
				},
				func(context.Context) (*plugin.Manager, error) {
					t.Fatal("invalid configuration reached runtime lookup")
					return nil, nil
				},
			)
			if _, err := resolver.bindProviderConfig(context.Background(), config); err == nil {
				t.Fatal("invalid plugin configuration was bound")
			}
		})
	}
}

func TestCLIPluginProviderOverridesRetainRawValues(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*runharness.AgentInputRequest)
	}{
		{"model whitespace", func(r *runharness.AgentInputRequest) { r.Model = " test-model " }},
		{"thinking off", func(r *runharness.AgentInputRequest) { r.Thinking = "off" }},
		{"thinking whitespace", func(r *runharness.AgentInputRequest) { r.Thinking = " " }},
		{"negative temperature", func(r *runharness.AgentInputRequest) { v := -0.5; r.Temperature = &v }},
		{"infinite temperature", func(r *runharness.AgentInputRequest) { v := math.Inf(1); r.Temperature = &v }},
		{"negative max tokens", func(r *runharness.AgentInputRequest) { v := -1; r.MaxTokens = &v }},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := runharness.AgentInputRequest{}
			test.change(&request)
			if _, err := applyCLIPluginProviderOverrides(cliPluginProviderConfig(), &request); err == nil {
				t.Fatal("raw plugin override was silently normalized")
			}
		})
	}
	temperature, maxTokens := 0.75, 512
	config, err := applyCLIPluginProviderOverrides(cliPluginProviderConfig(), &runharness.AgentInputRequest{
		Model: "other-model", Temperature: &temperature, MaxTokens: &maxTokens,
	})
	if err != nil || config.Model != "other-model" || config.Temperature != temperature || config.MaxTokens != maxTokens || config.ContextWindow != 4096 {
		t.Fatal("valid plugin overrides or top-level limits were lost:", err)
	}
}

func TestCLIPluginProviderResolverNeverFallsBackForUnpinnedBinding(t *testing.T) {
	previous := newCLIProviderInstance
	newCLIProviderInstance = func(ai.ProviderConfig) (provider.Provider, error) {
		t.Fatal("plugin binding reached the builtin provider constructor")
		return nil, nil
	}
	t.Cleanup(func() { newCLIProviderInstance = previous })
	for _, identity := range []string{"plugin:test.providers:text", "Plugin:test.providers:text", "plugin:test.providers", "custom"} {
		t.Run(identity, func(t *testing.T) {
			config := cliPluginProviderConfig()
			config.Type = identity
			raw, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			if identity == "custom" {
				var object map[string]json.RawMessage
				if err := json.Unmarshal(raw, &object); err != nil {
					t.Fatal(err)
				}
				object["_pluginRuntime"] = json.RawMessage(`{"generation":1}`)
				raw, err = json.Marshal(object)
				if err != nil {
					t.Fatal(err)
				}
			}
			binding, err := runharness.NewProviderBinding(config.ID, json.RawMessage(raw))
			if err != nil {
				t.Fatal(err)
			}
			resolver := newCLIProviderResolverState(t.TempDir())
			resolver.plugins = provider.NewPluginFactory(nil, nil)
			if _, err := resolver.resolve(context.Background(), runharness.ModelTurnRequest{Provider: config.ID, ProviderBinding: &binding}); err == nil {
				t.Fatal("unpinned or mismatched binding resolved")
			}
		})
	}
}

func TestCLIPluginProviderBindingHonorsCallerContextBeforeIO(t *testing.T) {
	root := filepath.Join(t.TempDir(), "uncreated")
	resolver := newCLIProviderResolverState(root)
	if err := resolver.bindInput(nil, &runharness.AgentInputRequest{}); !errors.Is(err, runharness.ErrRootContextRequired) {
		t.Fatal("nil binding context accepted:", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := resolver.bindInput(ctx, &runharness.AgentInputRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatal("caller cancellation lost:", err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("canceled input touched configuration storage:", err)
	}
}

func TestCLIPluginProviderPreflightRejectsBeforeRuntimeSecretLoading(t *testing.T) {
	root := t.TempDir()
	config := cliPluginProviderConfig()
	config.ID, config.AuthMode = "gonavi-ai", "bearer"
	raw, err := json.Marshal(map[string]any{"schemaVersion": 6, "providers": []ai.ProviderConfig{config}, "activeProvider": config.ID})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "ai_config.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	request := runharness.AgentInputRequest{Content: "hello"}
	resolver := newCLIProviderResolverState(root)
	if err := resolver.bindInput(context.Background(), &request); err == nil || request.HasProviderBinding() {
		t.Fatal("reserved hosted ID became a plugin binding")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(raw) {
		t.Fatal("invalid preflight rewrote configuration or secrets:", err)
	}
}
