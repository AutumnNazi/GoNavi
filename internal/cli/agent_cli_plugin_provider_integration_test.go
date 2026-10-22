package cli

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/plugin"
)

func TestCLIPluginProviderColdSubmitRealHTTP(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"CLI native\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	root := t.TempDir()
	examples, err := filepath.Abs("../../examples/plugins")
	if err != nil {
		t.Fatal(err)
	}
	installNativeAIProviderFixture(t, ctx, root, examples)
	config := ai.ProviderConfig{ID: "cli-native", Type: "plugin:sdk.examples.aiprovider:http", Name: "Local fixture", BaseURL: upstream.URL + "/v1", APIKey: "cli-test-key", Model: "gpt-4o-mini"}
	store := aiservice.NewProviderConfigStore(root, nil)
	if err := store.Save(aiservice.ProviderConfigStoreSnapshot{Providers: []ai.ProviderConfig{config}, ActiveProvider: config.ID}); err != nil {
		t.Fatal(err)
	}
	options := AgentHarnessOptions{DataRoot: root, KeyFile: filepath.Join(root, "agent.key")}
	readonly, err := defaultAgentHarnessFactory(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readonly.(*ledgerHarnessRuntime).harness.SubmitInput(ctx, runharness.AgentInputRequest{RequestID: "no-owner", Provider: config.ID, Content: "hello"}); err == nil {
		t.Fatal("queue-only submit activated plugin provider")
	}
	if calls.Load() != 0 {
		t.Fatal("readonly submit contacted model")
	}
	if err := readonly.Close(); err != nil {
		t.Fatal(err)
	}
	options.StartWorkers = true
	owner, err := defaultAgentHarnessFactory(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	runtime := owner.(*ledgerHarnessRuntime)
	// No wait-running helper between factory activation and actual SubmitInput.
	receipt, err := runtime.harness.SubmitInput(ctx, runharness.AgentInputRequest{RequestID: "cli-native-cold", Provider: config.ID, Content: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		read, err := runtime.harness.ReadRun(ctx, runharness.RunReadRequest{RunID: receipt.RunID})
		if err != nil {
			t.Fatal(err)
		}
		if read.Run.State.Terminal() {
			if read.Run.State != runharness.RunStateCompleted || calls.Load() != 1 {
				t.Fatalf("CLI run=%s calls=%d reason=%s", read.Run.State, calls.Load(), read.Run.TerminalReason)
			}
			return
		}
		select {
		case <-tick.C:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}

func installNativeAIProviderFixture(t *testing.T, ctx context.Context, root, examples string) {
	t.Helper()
	output := filepath.Join(t.TempDir(), "package")
	command := exec.CommandContext(ctx, "go", "-C", examples, "run", "./package", "-source", "./ai-provider", "-manifest", "./ai-provider/gonavi.plugin.json", "-output", output)
	command.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local")
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("native example build: %v\n%s", err, result)
	}
	manager, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close(ctx)
	inspection, err := manager.Inspect(ctx, output)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, plugin.InstallRequest{Path: output, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
}
