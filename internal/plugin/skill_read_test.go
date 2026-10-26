package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runningSkillManager(t *testing.T) (*Manager, Status, string) {
	t.Helper()
	manager := testManager(t)
	body := "# Authenticated private body\nOnly explicit reads expose this marker.\n"
	status := installSource(t, manager, skillPackage(t, skillManifest(), []byte(body)))
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	waitFor(t, "skill-only instance ready", func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		instance := manager.instances[status.Manifest.ID]
		return instance != nil && instance.ready
	})
	return manager, status, body
}

func TestSkillReadStaticOwnerAndNoBodyDiscovery(t *testing.T) {
	manager, status, body := runningSkillManager(t)
	manager.mu.Lock()
	process := manager.instances[status.Manifest.ID].process
	manager.mu.Unlock()
	if process != nil {
		t.Fatal("static skill package spawned a process")
	}
	serialized, err := json.Marshal(manager.List())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(serialized), "Authenticated private body") || strings.Contains(string(serialized), `"content"`) {
		t.Fatal("discovery exposed document body")
	}
	result, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != body || result.PluginID != status.Manifest.ID || result.SkillID != "guide" || result.Digest != status.Digest || result.Generation != status.Generation || result.Version != status.Manifest.Version {
		t.Fatalf("incorrect content provenance: %+v", result)
	}
	observer := managerAt(t, manager.root)
	if _, err = observer.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("other process/controller read body: %v", err)
	}
	safe, err := NewManager(Options{Root: manager.root, Disabled: true})
	if err != nil {
		t.Fatal(err)
	}
	defer safe.Close(context.Background())
	if _, err = safe.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("safe-mode body read: %v", err)
	}
}

func TestSkillReadRejectsWrongIdentityAndCancellation(t *testing.T) {
	manager, status, _ := runningSkillManager(t)
	ctx := context.Background()
	for _, id := range []string{"missing", "skills/guide/SKILL.md", "../SKILL.md", "Guide", "https://example/SKILL.md"} {
		if _, err := manager.ReadSkillGeneration(ctx, status.Manifest.ID, status.Generation, id, status.Digest); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unexpected skill selector %q: %v", id, err)
		}
	}
	if _, err := manager.ReadSkillGeneration(ctx, status.Manifest.ID, 0, "guide", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("zero generation: %v", err)
	}
	if _, err := manager.ReadSkillGeneration(ctx, status.Manifest.ID, status.Generation, "guide", strings.Repeat("f", 64)); !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("wrong digest: %v", err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	result, err := manager.ReadSkillGeneration(canceled, status.Manifest.ID, status.Generation, "guide", status.Digest)
	if !errors.Is(err, context.Canceled) || result != (SkillContent{}) {
		t.Fatalf("canceled read disclosed data: %+v %v", result, err)
	}
	if _, err = manager.ReadSkillGeneration(nil, status.Manifest.ID, status.Generation, "guide", status.Digest); err == nil {
		t.Fatal("nil context accepted")
	}
}

func TestSkillReadChecksWholePackageIntegrity(t *testing.T) {
	for _, relative := range []string{"skills/guide/SKILL.md", "asset.txt"} {
		t.Run(relative, func(t *testing.T) {
			manager, status, _ := runningSkillManager(t)
			target := filepath.Join(manager.root, "store", status.Digest, filepath.FromSlash(relative))
			if err := os.Chmod(target, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte("Unauthenticated replacement text"), 0600); err != nil {
				t.Fatal(err)
			}
			result, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
			if !errors.Is(err, ErrDigestMismatch) || result != (SkillContent{}) {
				t.Fatalf("tampered package disclosed body: %+v %v", result, err)
			}
		})
	}
}

func TestSkillReadUsesBytesCapturedByVerifiedHash(t *testing.T) {
	manager, status, body := runningSkillManager(t)
	lease, err := manager.acquireSkillRead(status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.releaseSkillRead(lease)
	verified, err := manager.verifySkillPackage(context.Background(), lease)
	if err != nil {
		t.Fatal(err)
	}
	// The public method follows this exact verify -> complete sequence. Mutate deterministically between them.
	target := filepath.Join(manager.root, "store", status.Digest, "skills", "guide", "SKILL.md")
	if err = os.Chmod(target, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(target, []byte("REPLACEMENT MUST NEVER BE RETURNED"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := manager.completeSkillRead(context.Background(), lease, verified)
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != body {
		t.Fatal("reader reopened document after verifying different bytes")
	}
	if _, err = manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("new read failed to notice replacement: %v", err)
	}
}

func TestSkillReadRechecksPermissionAndContextAfterVerification(t *testing.T) {
	manager, status, _ := runningSkillManager(t)
	lease, err := manager.acquireSkillRead(status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.releaseSkillRead(lease)
	verified, err := manager.verifySkillPackage(context.Background(), lease)
	if err != nil {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if value, err := manager.completeSkillRead(canceled, lease, verified); !errors.Is(err, context.Canceled) || value != (SkillContent{}) {
		t.Fatal("late cancellation returned body")
	}
	_, err = manager.mutate(context.Background(), func(state *diskState) (bool, error) {
		r := state.Records[status.Manifest.ID]
		r.Manifest.Permissions = nil
		r.Manifest.Contributes.Skills = nil
		state.Records[status.Manifest.ID] = r
		return true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if value, err := manager.completeSkillRead(context.Background(), lease, verified); !errors.Is(err, ErrDisabled) || value != (SkillContent{}) {
		t.Fatalf("late permission revocation returned body: %v", err)
	}
}

func TestSkillReadReenableUpdateRemoveReplayFences(t *testing.T) {
	manager, first, _ := runningSkillManager(t)
	ctx := context.Background()
	lease, err := manager.acquireSkillRead(first.Manifest.ID, first.Generation, "guide", first.Digest)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.releaseSkillRead(lease)
	verified, err := manager.verifySkillPackage(ctx, lease)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.SetEnabled(ctx, first.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, first.Manifest.ID, StateDisabled)
	if value, err := manager.completeSkillRead(ctx, lease, verified); !errors.Is(err, ErrDisabled) || value != (SkillContent{}) {
		t.Fatal("disable did not revoke pending skill result")
	}
	enableFixture(t, manager, first.Manifest.ID)
	next := waitState(t, manager, first.Manifest.ID, StateRunning)
	if _, err = manager.ReadSkillGeneration(ctx, first.Manifest.ID, first.Generation, "guide", first.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatal("re-enable replay accepted")
	}
	if next.Generation == first.Generation {
		t.Fatal("generation reused")
	}
	if _, err = manager.SetEnabled(ctx, first.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, first.Manifest.ID, StateDisabled)
	updated := skillManifest()
	updated.Version = "2.0.0"
	replacement := installSource(t, manager, skillPackage(t, updated, []byte("Updated authenticated text")))
	enableFixture(t, manager, updated.ID)
	replacement = waitState(t, manager, updated.ID, StateRunning)
	if _, err = manager.ReadSkillGeneration(ctx, updated.ID, replacement.Generation, "guide", first.Digest); !errors.Is(err, ErrDigestMismatch) {
		t.Fatal("update accepted previous digest")
	}
	if _, err = manager.SetEnabled(ctx, updated.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, updated.ID, StateDisabled)
	if err = manager.Remove(ctx, updated.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.ReadSkillGeneration(ctx, updated.ID, replacement.Generation, "guide", replacement.Digest); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removed skill remained readable: %v", err)
	}
	reinstall := installSource(t, manager, skillPackage(t, updated, []byte("Updated authenticated text")))
	enableFixture(t, manager, updated.ID)
	reinstall = waitState(t, manager, updated.ID, StateRunning)
	if reinstall.Digest != replacement.Digest || reinstall.Generation <= replacement.Generation {
		t.Fatal("reinstall fixture failed to preserve digest and advance generation")
	}
	if _, err = manager.ReadSkillGeneration(ctx, updated.ID, replacement.Generation, "guide", replacement.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatal("remove/reinstall replay accepted")
	}
}

func TestSkillReadsShareBoundedAdmission(t *testing.T) {
	manager, status, _ := runningSkillManager(t)
	first, err := manager.acquireSkillRead(status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.releaseSkillRead(first)
	second, err := manager.acquireSkillRead(status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.releaseSkillRead(second)
	if _, err = manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); !errors.Is(err, ErrBusy) {
		t.Fatalf("unbounded reads: %v", err)
	}
	if _, err = manager.SetEnabled(context.Background(), status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
}
