package provider

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginFactoryRealProcessFrozenSecretsAndEpoch(t *testing.T) {
	manager, factory, record := pluginFixtureManager(t)
	ctx := context.Background()
	config := pluginTestConfig()
	if _, err := factory.New(ctx, config); !errors.Is(err, ErrPluginProviderUnavailable) {
		t.Fatal("disabled package became a provider")
	}
	if manager.OwnsRuntime() {
		t.Fatal("factory implicitly started owner")
	}
	if _, err := manager.SetEnabled(ctx, "test.models", true); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	config.APIKey = "SELECTED_OLD_KEY"
	config.Headers = map[string]string{"X-Selected": "OLD_HEADER"}
	config.SecretRef = "UNRELATED_REF"
	config.HasSecret = true
	frozen, err := factory.Bind(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(frozen, &envelope) != nil {
		t.Fatal("binding not flat")
	}
	if string(envelope["contextWindow"]) != "4096" || envelope["_pluginRuntime"] == nil || (envelope["maxTokens"] != nil && string(envelope["maxTokens"]) != "0") {
		t.Fatal("binding budget or epoch shape changed")
	}
	config.APIKey = "REPLACEMENT_KEY"
	config.Headers["X-Selected"] = "REPLACEMENT_HEADER"
	resolved, err := factory.Resolve(ctx, frozen)
	if err != nil {
		t.Fatal(err)
	}
	result, err := resolved.Chat(ctx, pluginStreamRequest())
	if err != nil || result.Content != "subprocess" {
		t.Fatalf("actual child failed: %v %v", result, err)
	}
	raw, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	var projected pluginRequestEnvelope
	if json.Unmarshal(raw, &projected) != nil || projected.Config == nil || projected.Config.APIKey != "SELECTED_OLD_KEY" || projected.Config.Headers["X-Selected"] != "OLD_HEADER" {
		t.Fatal("binding reread mutable selected secrets")
	}
	for _, forbidden := range []string{"REPLACEMENT_KEY", "UNRELATED_REF", "secretRef", "hasSecret", "cliEnv"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("unselected configuration projected")
		}
	}
	if _, err = manager.Invoke(ctx, "test.models", "generate", json.RawMessage("{}")); err == nil {
		t.Fatal("reserved provider invoked through generic command")
	}
	if _, err = manager.SetEnabled(ctx, "test.models", false); err != nil {
		t.Fatal(err)
	}
	if _, err = resolved.Chat(ctx, pluginStreamRequest()); err == nil {
		t.Fatal("disabled resolved provider reused")
	}
	if _, err = factory.Resolve(ctx, frozen); err == nil {
		t.Fatal("disabled frozen binding resolved")
	}
	if _, err = manager.SetEnabled(ctx, "test.models", true); err != nil {
		t.Fatal(err)
	}
	if _, err = factory.New(ctx, config); err != nil {
		t.Fatal(err)
	}
	if _, err = factory.Resolve(ctx, frozen); err == nil {
		t.Fatal("old generation rebound after enable")
	}
}

func TestPluginFactoryRejectsForgedFrozenConfiguration(t *testing.T) {
	factory := NewPluginFactory(nil, func(context.Context) (*plugin.Manager, error) {
		t.Fatal("invalid frozen data requested runtime")
		return nil, nil
	})
	for _, raw := range []string{"null", "{}", `{"type":"plugin:test.models:chat","model":"model-1","_pluginRuntime":null}`, `{"type":"plugin:test.models:chat","model":"model-1","ID":"gonavi-ai"}`, `{"type":"plugin:test.models:chat","type":"openai"}`} {
		if _, err := factory.Resolve(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatal("forged binding accepted")
		}
	}
}
