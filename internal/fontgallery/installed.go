package fontgallery

import (
	"context"
	"encoding/json"
	"errors"
	"os"
)

func installation(entry Entry) Installed {
	return Installed{Entry: entry, Family: cssFamily(entry.ID), URL: assetURL(entry.Font)}
}
func previewed(entry Entry) Previewed {
	return Previewed{Entry: entry, Family: previewFamily(entry.ID), URL: assetURL(entry.Preview)}
}
func (s *Service) installedEntries() ([]Entry, error) {
	return s.readEntryList("installed.json")
}
func (s *Service) previewEntries() ([]Entry, error) {
	return s.readEntryList("previews.json")
}
func (s *Service) readEntryList(name string) ([]Entry, error) {
	payload, err := s.readFile(name, maxInstalledBytes)
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
		return nil, failure("integrity", "invalid installation metadata")
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
func selectEntry(entries []Entry, id, version string) (Entry, bool) {
	for index := len(entries) - 1; index >= 0; index-- {
		entry := entries[index]
		if entry.ID == id && (version == "" || entry.Version == version) {
			return entry, true
		}
	}
	return Entry{}, false
}

// Resolve verifies installed bytes offline.
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
			return failure("unavailable", "font is not installed")
		}
		_, err = s.verifiedAsset(entry.Font)
		return err
	})
	if err != nil {
		return Installed{}, err
	}
	return installation(entry), nil
}
func (s *Service) cachedPreview(ctx context.Context, entry Entry) (Previewed, error) {
	err := s.snapshotContext(ctx, func() error {
		previews, err := s.previewEntries()
		if err != nil {
			return err
		}
		cached, found := selectEntry(previews, entry.ID, entry.Version)
		if !found || cached.Preview != entry.Preview {
			return failure("unavailable", "preview is not cached")
		}
		_, err = s.verifiedAsset(cached.Preview)
		return err
	})
	if err != nil {
		return Previewed{}, err
	}
	return previewed(entry), nil
}

// Remove deletes exactly one installation. No UI selection is inferred.
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
		previews, err := s.previewEntries()
		if err != nil {
			return err
		}
		kept := make([]Entry, 0, len(entries)-1)
		for _, entry := range entries {
			if entry.ID == removed.ID && entry.Version == removed.Version {
				continue
			}
			kept = append(kept, entry)
		}
		if err := s.saveEntries("installed.json", kept); err != nil {
			return err
		}
		if entriesReferenceAsset(removed.Font.Path, kept, previews) {
			return nil
		}
		path, err := s.safePath(removed.Font.Path, false)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return wrap("storage_failed", err)
		}
		return wrap("storage_failed", os.Remove(path))
	})
}
func (s *Service) saveEntries(name string, entries []Entry) error {
	payload, err := encodeInstalledEntries(entries)
	if err != nil {
		return err
	}
	return wrap("storage_failed", s.atomicWrite(name, payload))
}
