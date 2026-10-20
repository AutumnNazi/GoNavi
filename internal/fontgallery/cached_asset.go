package fontgallery

import "context"

// registerCachedAsset verifies and registers an existing content-addressed asset
// under the storage transaction, so removal cannot race metadata registration.
// Only unavailable or invalid bytes fall back to downloading; metadata failures
// remain errors and never discard the asset's existing owners.
func (s *Service) registerCachedAsset(ctx context.Context, entry Entry, asset Asset, name string) (bool, error) {
	registered := false
	err := s.transactionContext(ctx, func() error {
		if _, err := s.verifiedAsset(asset); err != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		entries, err := s.readEntryList(name)
		if err != nil {
			return err
		}
		kept := make([]Entry, 0, len(entries)+1)
		for _, old := range entries {
			if old.ID != entry.ID || old.Version != entry.Version {
				kept = append(kept, old)
			}
		}
		if err := s.saveEntries(name, append(kept, entry)); err != nil {
			return err
		}
		registered = true
		return nil
	})
	return registered, err
}

func entriesReferenceAsset(name string, lists ...[]Entry) bool {
	for _, entries := range lists {
		for _, entry := range entries {
			if entry.Font.Path == name || entry.Preview.Path == name {
				return true
			}
		}
	}
	return false
}
