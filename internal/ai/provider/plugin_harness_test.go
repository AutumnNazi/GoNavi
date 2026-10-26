package provider_test

import (
	"bytes"
	"context"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
)

type pluginFailedModel struct{ calls atomic.Int32 }

func (m *pluginFailedModel) Execute(context.Context, runharness.ModelTurnRequest, runharness.ModelDeltaSink) (runharness.ModelTurnResult, error) {
	m.calls.Add(1)
	return runharness.ModelTurnResult{}, provider.ErrPluginProviderOperation
}

func TestPluginProviderErrorsAreNotAutomaticallyReplayedByHarness(t *testing.T) {
	for _, err := range []error{provider.ErrPluginProviderConfig, provider.ErrPluginProviderUnavailable, provider.ErrPluginProviderResponse, provider.ErrPluginProviderOperation, provider.ErrPluginProviderLimit} {
		if runharness.IsRetryableModelError(err) {
			t.Fatalf("unsafe automatic replay classification: %v", err)
		}
	}
	ledger, err := runharness.OpenWithKey(":memory:", bytes.Repeat([]byte{0x42}, 32))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := ledger.Close(); err != nil {
			t.Error(err)
		}
	})
	model := &pluginFailedModel{}
	harness, err := runharness.NewAgentRunHarness(runharness.HarnessConfig{Ledger: ledger, Model: model, RootContext: context.Background(), OwnerID: "plugin-no-replay", PollInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := harness.Close(); err != nil {
			t.Error(err)
		}
	})
	receipt, err := harness.SubmitInput(context.Background(), runharness.AgentInputRequest{RequestID: "unknown-plugin-outcome", Content: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		read, err := harness.ReadRun(ctx, runharness.RunReadRequest{RunID: receipt.RunID, Limit: 200})
		if err != nil {
			t.Fatal(err)
		}
		if read.Run.State.Terminal() {
			if read.Run.State != runharness.RunStateFailed || model.calls.Load() != 1 {
				t.Fatalf("unknown outcome replayed: %s calls=%d", read.Run.State, model.calls.Load())
			}
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("harness did not terminate")
		case <-ticker.C:
		}
	}
}
