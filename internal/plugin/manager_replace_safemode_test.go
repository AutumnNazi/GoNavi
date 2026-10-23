package plugin

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Safe mode cannot re-enable a plugin, so it must refuse the replacement instead of leaving
// a previously enabled plugin disabled with no way to restore it in this process.
func TestReplacePackageRefusesEnabledPluginInSafeMode(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	first, err := NewManager(Options{Root: root, HostVersion: "1.0.0"})
	if err != nil {
		t.Fatal(err)
	}
	installed := installSource(t, first, skillPackage(t, skillManifest(), []byte("first")))
	enableFixture(t, first, installed.Manifest.ID)
	updated := skillManifest()
	updated.Version = "2.0.0"
	source := skillPackage(t, updated, []byte("second"))
	inspection, err := first.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if err = first.Close(ctx); err != nil {
		t.Fatal(err)
	}
	safeMode, err := NewManager(Options{Root: root, HostVersion: "1.0.0", Disabled: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := safeMode.Close(ctx); err != nil {
			t.Error(err)
		}
	}()
	_, err = safeMode.ReplacePackage(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true})
	if !errors.Is(err, ErrDisabled) || !strings.Contains(err.Error(), "disable it first") {
		t.Fatalf("safe mode replace: %v", err)
	}
	statuses := safeMode.List()
	if len(statuses) != 1 || !statuses[0].DesiredEnabled || statuses[0].Manifest.Version != "1.0.0" {
		t.Fatalf("safe mode replace changed the record: %+v", statuses)
	}
}
