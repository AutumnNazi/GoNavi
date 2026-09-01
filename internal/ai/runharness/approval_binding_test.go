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
