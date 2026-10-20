package fontgallery

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/image/font/gofont/gomono"
)

func TestCachedAssetRegistrationFailurePreservesExistingOwner(t *testing.T) {
	for _, target := range []string{"installed.json", "previews.json"} {
		t.Run(target, func(t *testing.T) {
			s, err := NewService(Options{Root: t.TempDir(), Client: &http.Client{Transport: rejectTransport{t}}})
			if err != nil {
				t.Fatal(err)
			}
			entry := fixtureEntry(gomono.TTF)
			owner := "previews.json"
			if target == owner {
				owner = "installed.json"
			}
			if err := s.atomicWrite(entry.Font.Path, gomono.TTF); err != nil {
				t.Fatal(err)
			}
			if err := s.saveEntries(owner, []Entry{entry}); err != nil {
				t.Fatal(err)
			}
			failure := errors.New("injected metadata replacement failure")
			s.replaceFile = func(_, destination string) error {
				if filepath.Base(destination) != target {
					t.Errorf("unexpected replacement: %s", destination)
				}
				return failure
			}
			registered, err := s.registerCachedAsset(context.Background(), entry, entry.Font, target)
			if registered || !errors.Is(err, failure) {
				t.Fatalf("registered=%v err=%v", registered, err)
			}
			entries, err := s.readEntryList(target)
			if err != nil || len(entries) != 0 {
				t.Fatalf("failed registration persisted metadata: %v %v", entries, err)
			}
			entries, err = s.readEntryList(owner)
			if err != nil || len(entries) != 1 {
				t.Fatalf("lost existing owner: %v %v", entries, err)
			}
			if _, err := s.verifiedAsset(entry.Font); err != nil {
				t.Fatalf("lost existing bytes: %v", err)
			}
		})
	}
}

func TestCachedAssetRegistrationRejectsUnverifiedBytes(t *testing.T) {
	for _, kind := range []string{"tampered", "symlink", "wrong-size", "invalid-font"} {
		t.Run(kind, func(t *testing.T) {
			s, err := NewService(Options{Root: t.TempDir(), Client: &http.Client{Transport: rejectTransport{t}}})
			if err != nil {
				t.Fatal(err)
			}
			entry := fixtureEntry(gomono.TTF)
			payload := append([]byte(nil), gomono.TTF...)
			switch kind {
			case "tampered":
				payload[len(payload)-1] ^= 0xff
			case "wrong-size":
				payload = payload[:len(payload)-1]
			case "invalid-font":
				payload = []byte("not a font")
				entry = fixtureEntry(payload)
			}
			if kind == "symlink" {
				target := filepath.Join(t.TempDir(), "font.ttf")
				if err := os.WriteFile(target, payload, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, filepath.Join(s.root, entry.Font.Path)); err != nil {
					t.Fatal(err)
				}
			} else if err := s.atomicWrite(entry.Font.Path, payload); err != nil {
				t.Fatal(err)
			}
			registered, err := s.registerCachedAsset(context.Background(), entry, entry.Font, "installed.json")
			if err != nil || registered {
				t.Fatalf("invalid bytes registered=%v err=%v", registered, err)
			}
			entries, err := s.installedEntries()
			if err != nil || len(entries) != 0 {
				t.Fatalf("invalid bytes installed: %v %v", entries, err)
			}
		})
	}
}

func TestCachedAssetRegistrationHonorsCancellation(t *testing.T) {
	s, err := NewService(Options{Root: t.TempDir(), Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	entry := fixtureEntry(gomono.TTF)
	if err := s.atomicWrite(entry.Font.Path, gomono.TTF); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	registered, err := s.registerCachedAsset(ctx, entry, entry.Font, "installed.json")
	if registered || !errors.Is(err, context.Canceled) {
		t.Fatalf("registered=%v err=%v", registered, err)
	}
	entries, err := s.installedEntries()
	if err != nil || len(entries) != 0 {
		t.Fatalf("canceled registration mutated metadata: %v %v", entries, err)
	}
}

func TestEntriesReferenceAsset(t *testing.T) {
	for _, tc := range []struct {
		name  string
		lists [][]Entry
		want  bool
	}{
		{name: "absent"},
		{name: "font", lists: [][]Entry{{{Font: Asset{Path: "asset"}}}}, want: true},
		{name: "preview", lists: [][]Entry{{{Preview: Asset{Path: "asset"}}}}, want: true},
		{name: "later list", lists: [][]Entry{{{Font: Asset{Path: "other"}}}, {{Preview: Asset{Path: "asset"}}}}, want: true},
		{name: "other", lists: [][]Entry{{{Font: Asset{Path: "other"}}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := entriesReferenceAsset("asset", tc.lists...); got != tc.want {
				t.Fatalf("reference=%v want=%v", got, tc.want)
			}
		})
	}
}
