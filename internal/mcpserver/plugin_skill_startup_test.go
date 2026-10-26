package mcpserver

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillStartupForeverStartingReturnsPartialReadySnapshot(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	starting := fakeSkillStatus()
	starting.Manifest.ID = "test.starting"
	starting.State = plugin.StateStarting
	starting.Generation = 0
	ready := fakeSkillStatus()
	ready.Manifest.ID = "test.ready"
	want := []plugin.Status{starting, ready}
	reads := 0
	const budget = 30 * time.Millisecond
	began := time.Now()
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		return want
	}, func() bool { return true }, budget)
	elapsed := time.Since(began)
	if err != nil || ctx.Err() != nil {
		t.Fatalf("optional startup expiry = %v, parent=%v", err, ctx.Err())
	}
	if elapsed < budget || elapsed > 500*time.Millisecond {
		t.Fatalf("30 ms startup budget elapsed %s", elapsed)
	}
	if reads == 0 || !reflect.DeepEqual(got, want) {
		t.Fatalf("partial snapshot changed: reads=%d snapshot=%+v", reads, got)
	}
	bindings := pluginSkillBindings(got)
	if len(bindings) != 1 || bindings[0].pluginID != ready.Manifest.ID {
		t.Fatal("startup expiry discarded a ready skill or published a starting one")
	}
}

func TestPluginSkillStartupNoOwnerReturnsEmptyWithoutStatusReads(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	reads, ownershipReads := 0, 0
	began := time.Now()
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		return []plugin.Status{fakeSkillStatus()}
	}, func() bool {
		ownershipReads++
		return false
	}, 2*time.Second)
	if err != nil || len(got) != 0 || reads != 0 || ownershipReads != 1 {
		t.Fatalf("nonowner snapshot=%+v err=%v status reads=%d ownership reads=%d", got, err, reads, ownershipReads)
	}
	if elapsed := time.Since(began); elapsed > 250*time.Millisecond {
		t.Fatalf("nonowner waited %s", elapsed)
	}
}

func TestPluginSkillStartupUnrelatedStartingDoesNotWait(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*plugin.Status)
	}{
		{name: "no_ai_skills_permission", mutate: func(s *plugin.Status) { s.Manifest.Permissions = []string{"ai.tools"} }},
		{name: "no_declared_skill", mutate: func(s *plugin.Status) { s.Manifest.Contributes.Skills = nil }},
		{name: "desired_disabled", mutate: func(s *plugin.Status) { s.DesiredEnabled = false }},
		{name: "disabled_state", mutate: func(s *plugin.Status) { s.State = plugin.StateDisabled }},
		{name: "faulted_state", mutate: func(s *plugin.Status) { s.State = plugin.StateFaulted }},
		{name: "already_running", mutate: func(s *plugin.Status) { s.State = plugin.StateRunning }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
			defer cancel()
			status := fakeSkillStatus()
			status.State = plugin.StateStarting
			test.mutate(&status)
			want := []plugin.Status{status}
			reads := 0
			got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
				reads++
				return want
			}, func() bool { return true }, time.Second)
			if err != nil || ctx.Err() != nil || reads != 1 || !reflect.DeepEqual(got, want) {
				t.Fatalf("unrelated startup waited: err=%v parent=%v reads=%d snapshot=%+v", err, ctx.Err(), reads, got)
			}
		})
	}
}

func TestPluginSkillStartupReadyTransition(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	starting := fakeSkillStatus()
	starting.State = plugin.StateStarting
	starting.Generation = 0
	ready := fakeSkillStatus()
	reads := 0
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		if reads == 1 {
			return []plugin.Status{starting}
		}
		return []plugin.Status{ready}
	}, func() bool { return true }, 250*time.Millisecond)
	if err != nil || reads != 2 || !reflect.DeepEqual(got, []plugin.Status{ready}) {
		t.Fatalf("ready transition: snapshot=%+v err=%v reads=%d", got, err, reads)
	}
}

func TestPluginSkillStartupOwnershipLossDiscardsSnapshot(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	status := fakeSkillStatus()
	status.State = plugin.StateStarting
	reads, ownershipReads := 0, 0
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		return []plugin.Status{status}
	}, func() bool {
		ownershipReads++
		return ownershipReads == 1
	}, 250*time.Millisecond)
	if err != nil || len(got) != 0 || reads != 1 || ownershipReads != 2 {
		t.Fatalf("lost ownership: snapshot=%+v err=%v reads=%d ownership reads=%d", got, err, reads, ownershipReads)
	}
}

func TestPluginSkillStartupCancellationDuringSnapshot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	status := fakeSkillStatus()
	status.State = plugin.StateStarting
	reads := 0
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		cancel()
		return []plugin.Status{status}
	}, func() bool { return true }, time.Second)
	if !errors.Is(err, context.Canceled) || got != nil || reads != 1 {
		t.Fatalf("snapshot cancellation: snapshot=%+v err=%v reads=%d", got, err, reads)
	}
}

func TestPluginSkillStartupCancellationInterruptsWait(t *testing.T) {
	parent, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	status := fakeSkillStatus()
	status.State = plugin.StateStarting
	var cancellation *time.Timer
	defer func() {
		if cancellation != nil {
			cancellation.Stop()
		}
	}()
	reads := 0
	began := time.Now()
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		reads++
		if cancellation == nil {
			cancellation = time.AfterFunc(5*time.Millisecond, cancel)
		}
		return []plugin.Status{status}
	}, func() bool { return true }, 500*time.Millisecond)
	if !errors.Is(err, context.Canceled) || got != nil || reads == 0 {
		t.Fatalf("wait cancellation: snapshot=%+v err=%v reads=%d", got, err, reads)
	}
	if elapsed := time.Since(began); elapsed > 250*time.Millisecond {
		t.Fatalf("cancellation waited for startup budget: %s", elapsed)
	}
}

func TestPluginSkillStartupParentDeadlineInterruptsWait(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	status := fakeSkillStatus()
	status.State = plugin.StateStarting
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		return []plugin.Status{status}
	}, func() bool { return true }, time.Second)
	if !errors.Is(err, context.DeadlineExceeded) || got != nil {
		t.Fatalf("parent deadline: snapshot=%+v err=%v", got, err)
	}
}

func TestPluginSkillStartupRequiresLiveContext(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	for _, test := range []struct {
		name string
		ctx  context.Context
		err  error
	}{
		{name: "missing", err: runharness.ErrRootContextRequired},
		{name: "canceled", ctx: canceled, err: context.Canceled},
		{name: "deadline", ctx: expired, err: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			reads, ownershipReads := 0, 0
			got, err := waitForPluginSkillSnapshot(test.ctx, func() []plugin.Status {
				reads++
				return nil
			}, func() bool {
				ownershipReads++
				return true
			}, time.Second)
			if !errors.Is(err, test.err) || got != nil || reads != 0 || ownershipReads != 0 {
				t.Fatalf("invalid context: snapshot=%+v err=%v status reads=%d ownership reads=%d", got, err, reads, ownershipReads)
			}
		})
	}
}

func TestPluginSkillStartupNonpositiveBudgetReturnsCurrentSnapshot(t *testing.T) {
	for _, budget := range []time.Duration{0, -time.Second} {
		t.Run(budget.String(), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			status := fakeSkillStatus()
			status.State = plugin.StateStarting
			got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
				return []plugin.Status{status}
			}, func() bool { return true }, budget)
			if err != nil || !reflect.DeepEqual(got, []plugin.Status{status}) {
				t.Fatalf("zero startup allowance: snapshot=%+v err=%v", got, err)
			}
		})
	}
}

func TestPluginSkillStartupCapsMaximumWaitBudget(t *testing.T) {
	if pluginSkillStartupWait != 2*time.Second {
		t.Fatalf("production startup limit = %s, want 2s", pluginSkillStartupWait)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	status := fakeSkillStatus()
	status.State = plugin.StateStarting
	began := time.Now()
	got, err := waitForPluginSkillSnapshot(ctx, func() []plugin.Status {
		return []plugin.Status{status}
	}, func() bool { return true }, 10*time.Second)
	if err != nil || ctx.Err() != nil || !reflect.DeepEqual(got, []plugin.Status{status}) {
		t.Fatalf("oversized wait budget was not capped: err=%v parent=%v snapshot=%+v", err, ctx.Err(), got)
	}
	if elapsed := time.Since(began); elapsed < 2*time.Second || elapsed > 2800*time.Millisecond {
		t.Fatalf("capped startup wait elapsed %s", elapsed)
	}
}
