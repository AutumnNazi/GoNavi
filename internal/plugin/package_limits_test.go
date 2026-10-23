package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestZIPPreflightRejectsForgedDirectoryCount(t *testing.T) {
	source := writePackage(t, basicManifest("test.zip"))
	file := archivePackage(t, source, "zip")
	content, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	footer := bytes.LastIndex(content, []byte{0x50, 0x4b, 0x05, 0x06})
	if footer < 0 {
		t.Fatal("missing fixture footer")
	}
	binary.LittleEndian.PutUint16(content[footer+8:], 1)
	binary.LittleEndian.PutUint16(content[footer+10:], 1)
	if err = os.WriteFile(file, content, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = InspectPackage(context.Background(), file); err == nil {
		t.Fatal("forged zip record count accepted")
	}
}
func TestPackageHardLinksAndPrefixCollisions(t *testing.T) {
	t.Run("hard link", func(t *testing.T) {
		source := writePackage(t, basicManifest("test.link"))
		outside := filepath.Join(t.TempDir(), "outside")
		if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Link(outside, filepath.Join(source, "link")); err != nil {
			t.Skipf("hard links unavailable: %v", err)
		}
		if _, err := InspectPackage(context.Background(), source); err == nil {
			t.Fatal("hard link accepted")
		}
	})
	for _, names := range [][]string{{"Parent/a", "parent/b"}, {"parent/child", "parent"}, {"parent", "parent/child"}} {
		t.Run(names[0], func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "prefix.zip")
			f, err := os.Create(file)
			if err != nil {
				t.Fatal(err)
			}
			writer := zip.NewWriter(f)
			for _, name := range names {
				entry, err := writer.Create(name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = entry.Write([]byte("x")); err != nil {
					t.Fatal(err)
				}
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err = f.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err = InspectPackage(context.Background(), file); err == nil {
				t.Fatal("conflicting paths accepted")
			}
		})
	}
}
func TestStateWriteCancellationRollsBackInstall(t *testing.T) {
	m := testManager(t)
	old := installFixture(t, m, "test.rollback", "")
	updated := basicManifest(old.Manifest.ID)
	updated.Version = "2.0.0"
	source := writePackage(t, updated)
	inspection, err := m.Inspect(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := tryFileLock(filepath.Join(m.root, ".state.lock"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, installErr := m.Install(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true})
	if err = lock.Close(); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(installErr, context.DeadlineExceeded) {
		t.Fatalf("installation was not canceled: %v", installErr)
	}
	current := m.List()
	if len(current) != 1 || current[0].Digest != old.Digest {
		t.Fatal("failed publication changed installed record")
	}
}
func TestPurgeTombstonePreventsConcurrentReinstall(t *testing.T) {
	m := testManager(t)
	status := installFixture(t, m, "test.purge", "")
	ctx := context.Background()
	_, err := m.mutate(ctx, func(state *diskState) (bool, error) {
		r := state.Records[status.Manifest.ID]
		r.Removing = true
		state.Records[status.Manifest.ID] = r
		return true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.SetEnabled(ctx, status.Manifest.ID, true); !errors.Is(err, ErrBusy) {
		t.Fatalf("purging package enabled: %v", err)
	}
	source := writePackage(t, status.Manifest)
	inspection, err := m.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Install(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); !errors.Is(err, ErrBusy) {
		t.Fatalf("purging package replaced: %v", err)
	}
	data := filepath.Join(m.root, "data", status.Manifest.ID)
	if err = os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(data, "saved"), []byte("mutable"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = m.Remove(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(data); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("purge left mutable data")
	}
}
func TestInstalledPackageTamperingIsQuarantined(t *testing.T) {
	m := testManager(t)
	status := installFixture(t, m, "test.tamper", "")
	file := filepath.Join(m.root, "store", status.Digest, "asset.txt")
	if err := os.Chmod(file, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	enableFixture(t, m, status.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, status.Manifest.ID, StateFaulted)
}
