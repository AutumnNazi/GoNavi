package plugin

import (
	"context"
	"errors"
	"testing"
)

func TestReplacePackageKeepsEnableIntent(t *testing.T) {
	manager := testManager(t)
	ctx := context.Background()
	first := installSource(t, manager, skillPackage(t, skillManifest(), []byte("first generation")))
	enableFixture(t, manager, first.Manifest.ID)
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	running := waitState(t, manager, first.Manifest.ID, StateRunning)
	updated := skillManifest()
	updated.Version = "2.0.0"
	source := skillPackage(t, updated, []byte("second generation"))
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	replaced, err := manager.ReplacePackage(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Manifest.Version != "2.0.0" || !replaced.DesiredEnabled {
		t.Fatalf("replace did not keep intent: %+v", replaced)
	}
	next := waitState(t, manager, updated.ID, StateRunning)
	if next.Generation == running.Generation {
		t.Fatalf("generation was reused: %d", next.Generation)
	}
	content, err := manager.ReadSkillGeneration(ctx, updated.ID, next.Generation, "guide", next.Digest)
	if err != nil || content.Content != "second generation" {
		t.Fatalf("replaced body: %q %v", content.Content, err)
	}
	if _, err = manager.ReplacePackage(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatalf("same digest should be idempotent: %v", err)
	}
}

func TestReplacePackageRejectsUnknownAndMismatchedDigest(t *testing.T) {
	manager := testManager(t)
	ctx := context.Background()
	source := skillPackage(t, skillManifest(), []byte("body"))
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manager.ReplacePackage(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown plugin: %v", err)
	}
	untrusted := InstallRequest{Path: source, Digest: inspection.Digest}
	if _, err = manager.ReplacePackage(ctx, untrusted); err == nil {
		t.Fatal("untrusted replace was accepted")
	}
	if _, err = manager.ReplacePackage(ctx, InstallRequest{Path: source, Digest: "ab", Trusted: true}); !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("bad digest: %v", err)
	}
}
