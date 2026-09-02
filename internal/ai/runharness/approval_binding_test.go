package runharness

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestDecideApprovalBindsRunAndCallBeforeMutation(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	runA, err := ledger.CreateRun(ctx, CreateRunRequest{SessionID: "approval-a", Policy: DefaultRunPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	runB, err := ledger.CreateRun(ctx, CreateRunRequest{SessionID: "approval-b", Policy: DefaultRunPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	approval, err := ledger.CreateApproval(ctx, PutApprovalRequest{
		RunID: runA.ID, CallID: "call-a", ToolName: "write",
		Effect: ToolEffectSideEffect, Arguments: json.RawMessage(`{"value":1}`),
		RunRevision: runA.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}

	harness, err := NewAgentRunHarness(HarnessConfig{Ledger: ledger, RootContext: context.Background()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = harness.Close() })
	if _, err := harness.ControlRun(ctx, RunControlRequest{
		RunID: runB.ID, Action: ControlApprove, ApprovalID: approval.ApprovalID,
	}); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("cross-run approval error = %v", err)
	}
	if _, err := harness.ControlRun(ctx, RunControlRequest{
		RunID: runA.ID, CallID: "call-b", Action: ControlDeny,
		ApprovalID: approval.ApprovalID,
	}); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("wrong-call approval error = %v", err)
	}
	pending, err := ledger.GetApproval(ctx, approval.ApprovalID)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != "pending" || !pending.DecidedAt.IsZero() {
		t.Fatalf("mismatched decision mutated approval: %#v", pending)
	}

	// ExpectedCallID is intentionally optional for low-level callers. The run
	// binding alone still protects against cross-session approval reuse.
	decided, err := ledger.DecideApproval(ctx, DecideApprovalRequest{
		ApprovalID: approval.ApprovalID, Decision: "approved",
		ExpectedRunID: runA.ID, ExpectedRunRevision: runA.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if decided.Status != "approved" || decided.CallID != "call-a" {
		t.Fatalf("decided approval = %#v", decided)
	}
	if _, err := ledger.DecideApproval(ctx, DecideApprovalRequest{
		ApprovalID: approval.ApprovalID, Decision: "approved",
		ExpectedRunID: runA.ID, ExpectedCallID: "call-a",
	}); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("duplicate decision error = %v", err)
	}
}

func TestFailedRecoveryControlDoesNotLeaveConsumableCommand(t *testing.T) {
	ledger, run, _ := recoveryRunWithUnknownTool(t)
	ctx := context.Background()
	harness, err := NewAgentRunHarness(HarnessConfig{Ledger: ledger, RootContext: context.Background()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = harness.Close() })

	_, err = harness.ControlRun(ctx, RunControlRequest{
		RequestID: "invalid-recovery-command", RunID: run.ID,
		CallID: "missing-call", Action: ControlMarkCompleted,
		ExpectedRevision: run.Revision,
	})
	if !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("recovery error = %v", err)
	}
	var commands int
	if err := ledger.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM control_commands WHERE id=? AND consumed_at=0`, "invalid-recovery-command").Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if commands != 0 {
		t.Fatalf("failed recovery left %d consumable commands", commands)
	}
}

func TestRecoveryControlCommandConflictDoesNotApplyTransition(t *testing.T) {
	ledger, run, _ := recoveryRunWithUnknownTool(t)
	ctx := context.Background()
	defer ledger.Close()
	harness, err := NewAgentRunHarness(HarnessConfig{Ledger: ledger, RootContext: context.Background()})
	if err != nil {
		t.Fatal(err)
	}
	defer harness.Close()

	// Occupy the request ID with a different command before the recovery call.
	// The recovery transition must be rejected in the same transaction boundary,
	// leaving both the unknown tool and run revision untouched.
	requestID := "recovery-command-collision"
	if _, err := ledger.EnqueueCommand(ctx, ControlCommand{
		ID: requestID, RunID: run.ID, Action: ControlCancel,
		Payload: json.RawMessage(`{"reason":"other-intent"}`), ExpectedRevision: run.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	_, err = harness.ControlRun(ctx, RunControlRequest{
		RequestID: requestID, RunID: run.ID, CallID: "write-1",
		Action: ControlMarkCompleted, ExpectedRevision: run.Revision,
	})
	if !errors.Is(err, ErrControlCommandConflict) {
		t.Fatalf("recovery command collision error = %v", err)
	}
	latest, err := ledger.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.State != RunStateRecoveryRequired || latest.Revision != run.Revision {
		t.Fatalf("run changed after command collision: before=%#v after=%#v", run, latest)
	}
	var status string
	var unknown int
	if err := ledger.db.QueryRowContext(ctx, `SELECT status,unknown_outcome FROM tool_calls WHERE run_id=? AND call_id=?`, run.ID, "write-1").Scan(&status, &unknown); err != nil {
		t.Fatal(err)
	}
	if status != "unknown" || unknown != 1 {
		t.Fatalf("unknown tool changed after command collision: status=%q unknown=%d", status, unknown)
	}
}

func TestRecoveryControlRetryWithSameRequestIDIsIdempotent(t *testing.T) {
	ledger, run, _ := recoveryRunWithUnknownTool(t)
	ctx := context.Background()
	defer ledger.Close()
	harness, err := NewAgentRunHarness(HarnessConfig{Ledger: ledger, RootContext: context.Background()})
	if err != nil {
		t.Fatal(err)
	}
	defer harness.Close()

	request := RunControlRequest{
		RequestID: "recovery-idempotent-request", RunID: run.ID, CallID: "write-1",
		Action: ControlMarkCompleted, ExpectedRevision: run.Revision,
	}
	first, err := harness.ControlRun(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := harness.ControlRun(ctx, request)
	if err != nil {
		t.Fatalf("retrying recovery control: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("retry returned a different run: first=%#v second=%#v", first, second)
	}
	// ControlRun starts a worker after recovery. Acquiring its lease may advance
	// the run revision between the two calls, so revision equality is not an
	// idempotency guarantee. The recovery checkpoint and tool settlement are the
	// durable boundaries that must remain exactly-once.
	var recoveryEvents int
	if err := ledger.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE run_id=? AND kind=?`, run.ID, EventCheckpoint).Scan(&recoveryEvents); err != nil {
		t.Fatal(err)
	}
	if recoveryEvents != 1 {
		t.Fatalf("recovery retry emitted %d checkpoint events, want 1", recoveryEvents)
	}
	var commandCount int
	var appliedAt, consumedAt int64
	if err := ledger.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MAX(applied_at),0),COALESCE(MAX(consumed_at),0) FROM control_commands WHERE id=?`, request.RequestID).Scan(&commandCount, &appliedAt, &consumedAt); err != nil {
		t.Fatal(err)
	}
	if commandCount != 1 || appliedAt == 0 || consumedAt == 0 {
		t.Fatalf("recovery command marker = count %d applied %d consumed %d, want one applied marker", commandCount, appliedAt, consumedAt)
	}
	var status string
	var unknown int
	if err := ledger.db.QueryRowContext(ctx, `SELECT status,unknown_outcome FROM tool_calls WHERE run_id=? AND call_id=?`, run.ID, "write-1").Scan(&status, &unknown); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || unknown != 0 {
		t.Fatalf("recovery retry changed tool settlement: status=%q unknown=%d", status, unknown)
	}
}
