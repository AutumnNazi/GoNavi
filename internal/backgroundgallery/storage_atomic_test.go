package backgroundgallery

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/appdata"
)

func TestDownloadLateMetadataFailureRollsBackOnlyNewAsset(t *testing.T) {
	for _, shared := range []bool{false, true} {
		name := "new-asset"
		if shared {
			name = "shared-installed-asset"
		}
		t.Run(name, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			previous := entry
			previous.ID = "previous"
			s, root := storageFixture(t, []Entry{previous, entry}, payload)
			if shared {
				if _, err := s.Download(context.Background(), previous.ID, previous.Version, nil); err != nil {
					t.Fatal(err)
				}
			}
			target := filepath.Join(s.root, filepath.FromSlash(entry.Image.Path))
			injected := errors.New("metadata replacement failed after asset rename")
			reachedCommit := false
			s.replaceFile = func(source, destination string) error {
				if filepath.Base(destination) == "installed.json" {
					// Fail only when final bytes are already in place, not during
					// the initial metadata read or before the asset rename.
					stored, err := os.ReadFile(target)
					if err != nil || !bytes.Equal(stored, payload) {
						t.Fatalf("final asset absent before injected metadata failure: %v", err)
					}
					reachedCommit = true
					return injected
				}
				return appdata.AtomicReplaceFile(source, destination)
			}
			_, err := s.Download(context.Background(), entry.ID, entry.Version, nil)
			if !reachedCommit || !errors.Is(err, injected) || ErrorCode(err) != "storage_failed" {
				t.Fatalf("did not fail at late commit: reached=%v err=%v", reachedCommit, err)
			}
			s.replaceFile = appdata.AtomicReplaceFile
			assertNoTemps(t, root)
			if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
				t.Fatalf("failed installation became visible: %v", err)
			}
			if shared {
				if _, err := s.Resolve(previous.ID, previous.Version); err != nil {
					t.Fatalf("failed commit damaged previous shared installation: %v", err)
				}
			} else {
				if _, err := os.Lstat(target); !os.IsNotExist(err) {
					t.Errorf("late commit leaked unreferenced final asset: %v", err)
				}
				recorder := httptest.NewRecorder()
				s.ServeHTTP(recorder, httptest.NewRequest("GET", installation(entry).URL, nil))
				if recorder.Code != 404 {
					t.Errorf("failed installation served: %d", recorder.Code)
				}
			}
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
				t.Fatalf("retry after failed commit: %v", err)
			}
			if err := s.Remove(entry.ID, entry.Version); err != nil {
				t.Fatal(err)
			}
			if shared {
				if _, err := s.Resolve(previous.ID, previous.Version); err != nil {
					t.Fatalf("removing retry damaged previous shared installation: %v", err)
				}
			}
		})
	}
}

func TestDownloadFailureAfterRenameRespectsCommittedReferences(t *testing.T) {
	for _, metadataCommitted := range []bool{false, true} {
		name := "asset-directory-sync-failure"
		if metadataCommitted {
			name = "metadata-directory-sync-failure"
		}
		t.Run(name, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			s, root := storageFixture(t, []Entry{entry}, payload)
			injected := errors.New("directory sync failed after rename")
			reachedFailure := false
			s.replaceFile = func(source, target string) error {
				if err := appdata.AtomicReplaceFile(source, target); err != nil {
					return err
				}
				if (filepath.Base(target) == "installed.json") == metadataCommitted {
					reachedFailure = true
					return injected
				}
				return nil
			}
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); !errors.Is(err, injected) || !reachedFailure {
				t.Fatalf("did not reach post-rename failure: %v", err)
			}
			s.replaceFile = appdata.AtomicReplaceFile
			assertNoTemps(t, root)
			if metadataCommitted {
				// A durability error must not remove bytes now referenced by the
				// visible metadata, even though Download correctly reported failure.
				assertOfflineStorageReads(t, s, entry, payload)
				if err := s.Remove(entry.ID, entry.Version); err != nil {
					t.Fatal(err)
				}
			} else if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
				t.Fatalf("asset-only rename exposed an install: %v", err)
			}
			if _, err := os.Lstat(filepath.Join(s.root, filepath.FromSlash(entry.Image.Path))); !os.IsNotExist(err) {
				t.Fatalf("unreferenced asset remains after failure/removal: %v", err)
			}
		})
	}
}

func TestDownloadPreflightsMetadataBoundsBeforeAssetRename(t *testing.T) {
	for _, byteLimit := range []bool{false, true} {
		name := "entry-limit"
		if byteLimit {
			name = "metadata-byte-limit"
		}
		t.Run(name, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			if byteLimit {
				entry.License.Text = strings.Repeat("x", 65536)
			}
			s, root := storageFixture(t, []Entry{entry}, payload)
			entries := make([]Entry, 0, maxInstalledEntries)
			encodedSize := 2
			for index := range maxInstalledEntries {
				old := entry
				old.Version = fmt.Sprintf("old-%03d", index)
				encoded, err := json.Marshal(old)
				if err != nil {
					t.Fatal(err)
				}
				if byteLimit && encodedSize+len(encoded)+1 > maxInstalledBytes {
					break
				}
				entries = append(entries, old)
				encodedSize += len(encoded) + 1
			}
			if byteLimit && len(entries) == maxInstalledEntries {
				t.Fatal("fixture does not exercise metadata byte limit")
			}
			metadata, err := json.Marshal(entries)
			if err != nil || len(metadata) > maxInstalledBytes {
				t.Fatalf("invalid starting metadata fixture: %v", err)
			}
			metadataPath := filepath.Join(s.root, "installed.json")
			if err := os.WriteFile(metadataPath, metadata, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(s.root, filepath.FromSlash(entry.Image.Path)), payload, 0600); err != nil {
				t.Fatal(err)
			}
			replaced := false
			s.replaceFile = func(source, target string) error {
				replaced = true
				return appdata.AtomicReplaceFile(source, target)
			}
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); ErrorCode(err) != "storage_failed" {
				t.Fatalf("metadata capacity not rejected: %v", err)
			}
			if replaced {
				t.Error("metadata constraints checked only after publishing asset")
			}
			stored, err := os.ReadFile(metadataPath)
			if err != nil || !bytes.Equal(stored, metadata) {
				t.Fatalf("failed preflight changed installed metadata: %v", err)
			}
			if _, err := s.Resolve(entry.ID, entries[0].Version); err != nil {
				t.Fatalf("failed preflight damaged previous install: %v", err)
			}
			assertNoTemps(t, root)
		})
	}
}
