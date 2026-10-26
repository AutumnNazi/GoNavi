package provider

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

// This fixture is a real child process, not a production/model connectivity claim.
func TestPluginProviderFixtureProcess(t *testing.T) {
	record := ""
	for i, arg := range os.Args {
		if arg == "--provider-fixture" && i+1 < len(os.Args) {
			record = os.Args[i+1]
		}
	}
	if record == "" {
		return
	}
	decoder, encoder := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	sessions := map[string]int{}
	batched := map[string]bool{}
	for {
		var rpc struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if decoder.Decode(&rpc) != nil {
			os.Exit(0)
		}
		var result any = struct{}{}
		switch rpc.Method {
		case "plugin.initialize":
			result = map[string]int{"apiVersion": 1}
		case "plugin.invoke":
			var params struct {
				Arguments json.RawMessage `json:"arguments"`
			}
			var request pluginRequestEnvelope
			if json.Unmarshal(rpc.Params, &params) != nil || json.Unmarshal(params.Arguments, &request) != nil {
				os.Exit(2)
			}
			switch request.Operation {
			case "start":
				if os.WriteFile(record, params.Arguments, 0600) != nil {
					os.Exit(3)
				}
				sessions[request.RequestID] = 0
				batched[request.RequestID] = request.Config != nil && request.Config.Headers["X-Cached-Batch"] == "yes"
				result = map[string]bool{"accepted": true}
			case "pull":
				sessions[request.RequestID]++
				if batched[request.RequestID] {
					result = map[string]any{"events": []any{map[string]any{"sequence": 1, "type": "delta", "content": "first"}, map[string]any{"sequence": 2, "type": "delta", "content": "second"}, map[string]any{"sequence": 3, "type": "done", "finishReason": "stop"}}}
				} else if sessions[request.RequestID] == 1 {
					result = map[string]any{"events": []any{map[string]any{"sequence": 1, "type": "delta", "content": "subprocess"}}}
				} else {
					result = map[string]any{"events": []any{map[string]any{"sequence": 2, "type": "done", "finishReason": "stop"}}}
				}
			case "cancel":
				delete(sessions, request.RequestID)
				result = map[string]bool{"ok": true}
			default:
				os.Exit(4)
			}
		}
		if len(rpc.ID) != 0 {
			if encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				os.Exit(5)
			}
		}
		if rpc.Method == "plugin.shutdown" {
			os.Exit(0)
		}
	}
}

func pluginFixtureManager(t *testing.T) (*plugin.Manager, *PluginFactory, string) {
	m, f, record, _ := pluginFixtureManagerOptions(t, false)
	return m, f, record
}

func pluginFixtureManagerOptions(t *testing.T, dependency bool) (*plugin.Manager, *PluginFactory, string, string) {
	t.Helper()
	root := t.TempDir()
	source := t.TempDir()
	record := filepath.Join(t.TempDir(), "selected.json")
	executable := "backend"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	current, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.Open(current)
	if err != nil {
		t.Fatal(err)
	}
	output, err := os.OpenFile(filepath.Join(source, executable), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		input.Close()
		t.Fatal(err)
	}
	_, copyErr := io.Copy(output, input)
	inErr, outErr := input.Close(), output.Close()
	if copyErr != nil || inErr != nil || outErr != nil {
		t.Fatal("copy fixture failed")
	}
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.models", Name: "Provider fixture", Version: "1.0.0", Permissions: []string{"ai.providers"}, Backend: &plugin.Backend{Default: &plugin.Entry{Executable: executable, Args: []string{"-test.run=^TestPluginProviderFixtureProcess$", "--", "--provider-fixture", record}}}, Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "generate", Title: "Generate"}}, AIProviders: []plugin.AIProvider{{ID: "chat", Name: "Chat", Command: "generate", SupportsTools: true, Models: []plugin.AIModel{{ID: "model-1", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 128}}}}}}
	if dependency {
		manifest.Requires = []plugin.Dependency{{ID: "test.dependency", MinVersion: "1.0.0"}}
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	interval := 5 * time.Millisecond
	if dependency {
		interval = time.Hour
	}
	manager, err := plugin.NewManager(plugin.Options{Root: root, ReconcileInterval: interval, ShutdownTimeout: 250 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	ctx := context.Background()
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Install(ctx, plugin.InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	factory := NewPluginFactory(func(context.Context) (PluginProviderSnapshot, error) {
		return PluginProviderSnapshot{Statuses: manager.List(), Owned: manager.OwnsRuntime()}, nil
	}, func(context.Context) (*plugin.Manager, error) { return manager, nil })
	if dependency {
		pluginFixtureDependency(t, manager)
	}
	return manager, factory, record, root
}
