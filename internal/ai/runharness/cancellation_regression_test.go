package runharness

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

type ignoresTurnCancellationModel struct {
	started      chan struct{}
	release      chan struct{}
	lateCallback chan error
	once         sync.Once
}

func (m *ignoresTurnCancellationModel) Execute(_ context.Context, _ ModelTurnRequest, sink ModelDeltaSink) (ModelTurnResult, error) {
	m.once.Do(func() { close(m.started) })
	<-m.release // Intentionally ignore the caller's cancellation context.
	m.lateCallback <- sink(context.Background(), ModelDelta{Text: "late delta"})
	return ModelTurnResult{Text: "late completion", Completed: true}, nil
}

func TestHarnessDeadlineDropsLateModelCallbackAfterTerminal(t *testing.T) {
	model := &ignoresTurnCancellationModel{
		started:      make(chan struct{}),
		release:      make(chan struct{}),
		lateCallback: make(chan error, 1),
	}
	harness, _ := newContractHarness(t, model, nil, nil)
	policy := DefaultRunPolicy()
	policy.ModelTurnTimeout = 20 * time.Millisecond
	policy.MaxModelRetriesPerTurn = 0
	if err := harness.SetDefaultPolicy(policy); err != nil {
		t.Fatalf("set default policy: %v", err)
	}

	receipt, err := harness.SubmitInput(context.Background(), AgentInputRequest{RequestID: "late-model-callback", Content: "wait"})
	if err != nil {
		t.Fatalf("submit input: %v", err)
	}
	select {
	case <-model.started:
	case <-time.After(time.Second):
		t.Fatal("model did not start")
	}
	read := waitContractRun(t, harness, receipt.RunID, func(run RunSnapshot) bool { return run.State.Terminal() })
	if read.Run.State != RunStateFailed {
		t.Fatalf("run state = %s, want %s", read.Run.State, RunStateFailed)
	}
	assertDeadlineTerminal(t, read.Events)
	sequenceBeforeRelease := read.Run.NextSequence

	close(model.release)
	select {
	case callbackErr := <-model.lateCallback:
		if !errors.Is(callbackErr, context.Canceled) {
			t.Fatalf("late callback error = %v, want context.Canceled", callbackErr)
		}
	case <-time.After(time.Second):
		t.Fatal("late model callback did not return")
	}

	// Give the detached adapter goroutine a chance to finish. Its callback must
	// not be able to append an event after the terminal boundary.
	time.Sleep(30 * time.Millisecond)
	after, err := harness.ReadRun(context.Background(), RunReadRequest{RunID: receipt.RunID, Limit: 100})
	if err != nil {
		t.Fatalf("read terminal run: %v", err)
	}
	if after.Run.NextSequence != sequenceBeforeRelease {
		t.Fatalf("late callback advanced sequence from %d to %d", sequenceBeforeRelease, after.Run.NextSequence)
	}
	assertDeadlineTerminal(t, after.Events)
}

func assertDeadlineTerminal(t *testing.T, events []RunEvent) {
	t.Helper()
	terminalCount := 0
	seenDeadline := false
	for index, event := range events {
		if event.Kind == EventRunError {
			var payload RunErrorEvent
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				t.Fatalf("decode run error: %v", err)
			}
			seenDeadline = seenDeadline || payload.Code == ModelErrorDeadline
		}
		if event.Kind != EventTerminal {
			continue
		}
		terminalCount++
		if event.ResultingState != RunStateFailed {
			t.Fatalf("terminal state = %s, want %s", event.ResultingState, RunStateFailed)
		}
		if index != len(events)-1 {
			t.Fatalf("event after terminal: %#v", events[index+1:])
		}
	}
	if !seenDeadline {
		t.Fatalf("events missing deadline error: %#v", events)
	}
	if terminalCount != 1 {
		t.Fatalf("terminal events = %d, want 1", terminalCount)
	}
}

type steeringModel struct {
	mu       sync.Mutex
	requests []ModelTurnRequest
}

func (m *steeringModel) Execute(_ context.Context, request ModelTurnRequest, _ ModelDeltaSink) (ModelTurnResult, error) {
	m.mu.Lock()
	m.requests = append(m.requests, request)
	call := len(m.requests)
	m.mu.Unlock()
	if call == 1 {
		return ModelTurnResult{ToolCalls: []ToolIntent{{
			CallID: "steered-read", ToolName: "read", Arguments: json.RawMessage(`{}`),
		}}, Completed: true}, nil
	}
	return ModelTurnResult{Text: "steered result", Completed: true}, nil
}

func (m *steeringModel) requestsSnapshot() []ModelTurnRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ModelTurnRequest(nil), m.requests...)
}

type steerCancelableReadExecutor struct {
	started  chan struct{}
	canceled chan error
	once     sync.Once
}

func (e *steerCancelableReadExecutor) Execute(ctx context.Context, _ ToolExecutionRequest) (ToolExecutionResult, error) {
	e.once.Do(func() { close(e.started) })
	<-ctx.Done()
	err := ctx.Err()
	e.canceled <- err
	return ToolExecutionResult{Status: "failed", ErrorCode: "canceled"}, err
}

func TestHarnessSteerCancelsReadOnlyToolThenRunsNewModelTurn(t *testing.T) {
	model := &steeringModel{}
	executor := &steerCancelableReadExecutor{
		started:  make(chan struct{}),
		canceled: make(chan error, 1),
	}
	catalog := &contractToolCatalog{
		descriptor: ToolDescriptor{
			Name: "read", Effect: ToolEffectReadOnly,
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`),
		},
		executor: executor,
		effect:   ToolEffectReadOnly,
	}
	harness, _ := newContractHarness(t, model, catalog, nil)

	receipt, err := harness.SubmitInput(context.Background(), AgentInputRequest{RequestID: "steer-read-request", Content: "read first"})
	if err != nil {
		t.Fatalf("submit input: %v", err)
	}
	select {
	case <-executor.started:
	case <-time.After(time.Second):
		t.Fatal("read-only tool did not start")
	}
	steer, err := harness.SubmitInput(context.Background(), AgentInputRequest{
		RequestID: "steer-read-command", SessionID: receipt.SessionID,
		Content: "instead, answer without reading", DispatchMode: DispatchSteer,
	})
	if err != nil {
		t.Fatalf("submit steer: %v", err)
	}
	if steer.Disposition != "steered" || steer.RunID != receipt.RunID {
		t.Fatalf("steer receipt = %#v, want active run %q", steer, receipt.RunID)
	}
	select {
	case cancelErr := <-executor.canceled:
		if !errors.Is(cancelErr, context.Canceled) {
			t.Fatalf("read-only tool cancellation = %v, want context.Canceled", cancelErr)
		}
	case <-time.After(time.Second):
		t.Fatal("steer did not cancel the read-only tool")
	}

	read := waitContractRun(t, harness, receipt.RunID, func(run RunSnapshot) bool { return run.State.Terminal() })
	if read.Run.State != RunStateCompleted {
		t.Fatalf("steered run state = %s, want %s", read.Run.State, RunStateCompleted)
	}
	requests := model.requestsSnapshot()
	if len(requests) != 2 {
		t.Fatalf("model calls = %d, want 2", len(requests))
	}
	if !requestContainsContent(requests[1].Messages, "instead, answer without reading") {
		t.Fatalf("new model turn did not receive steer input: %#v", requests[1].Messages)
	}
	if requestContainsContent(requests[1].Messages, "steered result") {
		t.Fatalf("new model request contains its future result: %#v", requests[1].Messages)
	}
	var canceledTool bool
	for _, event := range read.Events {
		if event.Kind != EventTool {
			continue
		}
		var payload ToolEvent
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("decode tool event: %v", err)
		}
		canceledTool = canceledTool || (payload.CallID == "steered-read" && payload.Status == "failed" && payload.ErrorCode == "canceled")
	}
	if !canceledTool {
		t.Fatalf("events missing canceled read-only tool outcome: %#v", read.Events)
	}
}

func requestContainsContent(messages []Message, content string) bool {
	for _, message := range messages {
		if message.Content == content {
			return true
		}
	}
	return false
}
