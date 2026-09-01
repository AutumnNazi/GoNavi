package runharness

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestLedgerControlCommandPersistsExpectedRevision(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	run, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID: "control-command-session",
		RequestID: "control-command-request",
		Policy:    DefaultRunPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}

	command, err := ledger.EnqueueCommand(ctx, ControlCommand{
		ID:               "control-command-1",
		RunID:            run.ID,
		Action:           ControlCancel,
		Payload:          json.RawMessage(`{"reason":"test"}`),
		ExpectedRevision: run.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if command.ExpectedRevision != run.Revision {
		t.Fatalf("enqueued expected revision = %d, want %d", command.ExpectedRevision, run.Revision)
	}

	commands, err := ledger.DequeueCommands(ctx, run.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 {
		t.Fatalf("dequeued commands = %#v", commands)
	}
	if commands[0].ExpectedRevision != run.Revision {
		t.Fatalf("dequeued expected revision = %d, want %d", commands[0].ExpectedRevision, run.Revision)
	}
	if string(commands[0].Payload) != `{"reason":"test"}` {
		t.Fatalf("dequeued payload = %s", commands[0].Payload)
	}
}

func TestLedgerControlCommandRejectsStaleExpectedRevision(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	run, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID: "control-command-stale-session",
		RequestID: "control-command-stale-request",
		Policy:    DefaultRunPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ledger.EnqueueCommand(ctx, ControlCommand{
		ID:               "control-command-stale",
		RunID:            run.ID,
		Action:           ControlCancel,
		ExpectedRevision: run.Revision + 1,
	})
	if !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale enqueue error = %v, want revision conflict", err)
	}
	commands, err := ledger.DequeueCommands(ctx, run.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 0 {
		t.Fatalf("stale command was persisted: %#v", commands)
	}
}

func TestControlCancelTerminatesUnleasedQueuedRunWithoutWorker(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	run, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID: "queued-cancel-session",
		RequestID: "queued-cancel-request",
		Policy:    DefaultRunPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	harness, err := NewAgentRunHarness(HarnessConfig{
		Ledger: ledger, RootContext: context.Background(), OwnerID: "queued-cancel-owner",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = harness.Close() })

	canceled, err := harness.ControlRun(ctx, RunControlRequest{
		RequestID:        "queued-cancel-command",
		RunID:            run.ID,
		Action:           ControlCancel,
		ExpectedRevision: run.Revision,
	})
	if err != nil {
		t.Fatalf("cancel queued run: %v", err)
	}
	if canceled.State != RunStateCanceled {
		t.Fatalf("cancel result state = %s, want %s", canceled.State, RunStateCanceled)
	}
	read, err := ledger.ReadRun(ctx, RunReadRequest{RunID: run.ID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	terminalCount := 0
	for _, event := range read.Events {
		if event.Kind == EventTerminal {
			terminalCount++
			if event.ResultingState != RunStateCanceled {
				t.Fatalf("terminal state = %s, want %s", event.ResultingState, RunStateCanceled)
			}
		}
	}
	if terminalCount != 1 {
		t.Fatalf("terminal event count = %d, want 1", terminalCount)
	}
}

func TestConsumeControlCommandsRejectsRevisionThatChangedAfterEnqueue(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	run, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID: "control-command-consumer-session",
		RequestID: "control-command-consumer-request",
		Policy:    DefaultRunPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.EnqueueCommand(ctx, ControlCommand{
		ID:               "control-command-consumer",
		RunID:            run.ID,
		Action:           ControlCancel,
		ExpectedRevision: run.Revision,
	}); err != nil {
		t.Fatal(err)
	}

	// Simulate a model/tool callback committing after the command was accepted
	// but before a different process obtains and consumes it.
	if _, err := ledger.AppendEvent(ctx, AppendEventRequest{
		RunID:            run.ID,
		ExpectedRevision: run.Revision,
		Kind:             EventCheckpoint,
		ResultingState:   RunStateQueued,
		Payload:          CheckpointEvent{},
	}); err != nil {
		t.Fatal(err)
	}

	harness, err := NewAgentRunHarness(HarnessConfig{Ledger: ledger, RootContext: context.Background(), OwnerID: "control-command-consumer"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = harness.Close() })
	executionCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	execution := &runExecution{
		runID:     run.ID,
		sessionID: run.SessionID,
		ctx:       executionCtx,
		cancel:    cancel,
		done:      make(chan struct{}),
		wake:      make(chan struct{}, 1),
	}

	if !harness.consumeControlCommands(ctx, execution) {
		t.Fatal("stale control command was not consumed")
	}
	if execution.cancelRequested.Load() {
		t.Fatal("stale cancel command changed execution state")
	}
	if executionCtx.Err() != nil {
		t.Fatalf("stale cancel command canceled execution: %v", executionCtx.Err())
	}

	read, err := ledger.ReadRun(ctx, RunReadRequest{RunID: run.ID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if read.Run.State != RunStateQueued {
		t.Fatalf("run state = %s, want queued", read.Run.State)
	}
	var conflict *RunErrorEvent
	for _, event := range read.Events {
		if event.Kind != EventRunError {
			continue
		}
		var payload RunErrorEvent
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Code == "revision_conflict" {
			conflict = &payload
		}
	}
	if conflict == nil {
		t.Fatalf("events = %#v, want revision_conflict", read.Events)
	}
	if !conflict.Retryable {
		t.Fatalf("revision conflict = %#v, want retryable", conflict)
	}
	commands, err := ledger.DequeueCommands(ctx, run.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 0 {
		t.Fatalf("stale command was replayable: %#v", commands)
	}
}
