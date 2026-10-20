package backgroundgallery

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
)

func installation(entry Entry) Installed {
	return Installed{Entry: entry, URL: AssetURLPrefix + strings.TrimPrefix(entry.Image.Path, "assets/")}
}
func (s *Service) installedEntries() ([]Entry, error) {
	payload, err := s.readFile("installed.json", maxInstalledBytes)
	if errors.Is(err, os.ErrNotExist) {
		return []Entry{}, nil
	}
	if err != nil {
		return nil, wrap("storage_failed", err)
	}
	var entries []Entry
	if err := decodeJSON(payload, &entries); err != nil {
		return nil, wrap("integrity", err)
	}
	if entries == nil || len(entries) > maxInstalledEntries {
		return nil, failure("integrity", "invalid installed metadata")
	}
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if err := validateEntry(entry); err != nil {
			return nil, wrap("integrity", err)
		}
		key := entry.ID + "/" + entry.Version
		if seen[key] {
			return nil, failure("integrity", "duplicate installation")
		}
		seen[key] = true
	}
	return entries, nil
}
func encodeInstalledEntries(entries []Entry) ([]byte, error) {
	if len(entries) > maxInstalledEntries {
		return nil, failure("storage_failed", "installation limit exceeded")
	}
	payload, err := json.Marshal(entries)
	if err != nil {
		return nil, wrap("storage_failed", err)
	}
	if len(payload) > maxInstalledBytes {
		return nil, failure("storage_failed", "installation metadata exceeds limit")
	}
	return payload, nil
}

func (s *Service) saveEntries(entries []Entry) error {
	payload, err := encodeInstalledEntries(entries)
	if err != nil {
		return err
	}
	return wrap("storage_failed", s.atomicWrite("installed.json", payload))
}
func selectEntry(entries []Entry, id, version string) (Entry, bool) {
	// Reverse installation order makes the empty-version compatibility lookup deterministic.
	for index := len(entries) - 1; index >= 0; index-- {
		entry := entries[index]
		if entry.ID == id && (version == "" || entry.Version == version) {
			return entry, true
		}
	}
	return Entry{}, false
}

// Resolve verifies installed bytes offline; an empty version selects the last
// installed version of that ID. Corrupt bytes are never repaired implicitly.
func (s *Service) Resolve(id, version string) (Installed, error) {
	return s.resolveContext(context.Background(), id, version)
}

func (s *Service) resolveContext(ctx context.Context, id, version string) (Installed, error) {
	if !validIdentity(id, version, true) {
		return Installed{}, failure("invalid_id", "invalid id or version")
	}
	var entry Entry
	err := s.snapshotContext(ctx, func() error {
		entries, err := s.installedEntries()
		if err != nil {
			return err
		}
		var found bool
		entry, found = selectEntry(entries, id, version)
		if !found {
			return failure("unavailable", "background is not installed")
		}
		_, err = s.verifiedAsset(entry.Image)
		return err
	})
	if err != nil {
		return Installed{}, err
	}
	return installation(entry), nil
}

// Remove deletes exactly one installation. Shared content is retained until
// its last installation is removed. No UI selection is inferred or changed.
func (s *Service) Remove(id, version string) error {
	if !validIdentity(id, version, true) {
		return failure("invalid_id", "invalid id or version")
	}
	return s.transaction(func() error {
		entries, err := s.installedEntries()
		if err != nil {
			return err
		}
		removed, found := selectEntry(entries, id, version)
		if !found {
			return nil
		}
		kept := make([]Entry, 0, len(entries)-1)
		referenced := false
		for _, entry := range entries {
			if entry.ID == removed.ID && entry.Version == removed.Version {
				continue
			}
			kept = append(kept, entry)
			if entry.Image.Path == removed.Image.Path {
				referenced = true
			}
		}
		if err := s.saveEntries(kept); err != nil {
			return err
		}
		if referenced {
			return nil
		}
		path, err := s.safePath(removed.Image.Path, false)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return wrap("storage_failed", err)
		}
		return wrap("storage_failed", os.Remove(path))
	})
}
