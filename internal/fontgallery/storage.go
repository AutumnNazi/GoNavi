package fontgallery

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"GoNavi-Wails/internal/appdata"
)

func (s *Service) safePath(name string, missing bool) (string, error) {
	for _, dir := range []string{filepath.Dir(filepath.Dir(s.root)), filepath.Dir(s.root), s.root, filepath.Join(s.root, "assets")} {
		info, err := os.Lstat(dir)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", failure("storage_failed", "unsafe storage directory")
		}
	}
	target := filepath.Join(s.root, filepath.FromSlash(name))
	rel, err := filepath.Rel(s.root, target)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || len(rel) > 3 && rel[:3] == ".."+string(filepath.Separator) {
		return "", failure("storage_failed", "unsafe storage path")
	}
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) && missing {
		return target, nil
	}
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", failure("storage_failed", "storage file is not regular")
	}
	return target, nil
}
func (s *Service) readFile(name string, limit int64) ([]byte, error) {
	path, err := s.safePath(name, false)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > limit {
		return nil, failure("integrity", "invalid stored file size")
	}
	payload, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, failure("integrity", "stored file exceeds limit")
	}
	return payload, nil
}
func (s *Service) snapshotContext(ctx context.Context, action func() error) error {
	if err := waitForStorageLock(ctx, s.mu.TryRLock); err != nil {
		return err
	}
	defer s.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return action()
}
func (s *Service) snapshot(action func() error) error {
	return s.snapshotContext(context.Background(), action)
}
func (s *Service) transaction(action func() error) error {
	return s.transactionContext(context.Background(), action)
}
func (s *Service) transactionContext(ctx context.Context, action func() error) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	lockPath, err := s.safePath(".storage.lock", true)
	if err != nil {
		return wrap("storage_failed", err)
	}
	lock, err := appdata.AcquireFileLockContext(ctx, lockPath)
	if err != nil {
		return wrap("storage_failed", err)
	}
	defer func() { err = errors.Join(err, wrap("storage_failed", lock.Close())) }()
	if err := waitForStorageLock(ctx, s.mu.TryLock); err != nil {
		return err
	}
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return action()
}
func waitForStorageLock(ctx context.Context, tryLock func() bool) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if tryLock() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
func (s *Service) atomicWrite(name string, payload []byte) (err error) {
	target, err := s.safePath(name, true)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(target), ".font-gallery-*")
	if err != nil {
		return err
	}
	temp := file.Name()
	defer func() {
		if removeErr := os.Remove(temp); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			err = errors.Join(err, removeErr)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Sync(); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Close(); err != nil {
		return err
	}
	return s.replaceFile(temp, target)
}
func (s *Service) commitInstallation(temp string, entry Entry) (err error) {
	entries, err := s.installedEntries()
	if err != nil {
		return err
	}
	kept := make([]Entry, 0, len(entries)+1)
	for _, old := range entries {
		if old.ID != entry.ID || old.Version != entry.Version {
			kept = append(kept, old)
		}
	}
	payload, err := encodeInstalledEntries(append(kept, entry))
	if err != nil {
		return err
	}
	target, err := s.safePath(entry.Font.Path, true)
	if err != nil {
		return wrap("storage_failed", err)
	}
	_, statErr := os.Lstat(target)
	introduced := errors.Is(statErr, os.ErrNotExist)
	if statErr != nil && !introduced {
		return wrap("storage_failed", statErr)
	}
	defer func() {
		if err != nil && introduced {
			err = errors.Join(err, s.rollbackUnreferencedAsset(entry.Font.Path))
		}
	}()
	if err := s.replaceFile(temp, target); err != nil {
		return wrap("storage_failed", err)
	}
	return wrap("storage_failed", s.atomicWrite("installed.json", payload))
}
func (s *Service) commitPreview(temp string, entry Entry) (err error) {
	previews, err := s.previewEntries()
	if err != nil {
		return err
	}
	kept := make([]Entry, 0, len(previews)+1)
	for _, old := range previews {
		if old.ID != entry.ID || old.Version != entry.Version {
			kept = append(kept, old)
		}
	}
	payload, err := encodeInstalledEntries(append(kept, entry))
	if err != nil {
		return err
	}
	target, err := s.safePath(entry.Preview.Path, true)
	if err != nil {
		return wrap("storage_failed", err)
	}
	if err := s.replaceFile(temp, target); err != nil {
		return wrap("storage_failed", err)
	}
	return wrap("storage_failed", s.atomicWrite("previews.json", payload))
}
func (s *Service) rollbackUnreferencedAsset(name string) error {
	entries, err := s.installedEntries()
	if err != nil {
		return err
	}
	previews, err := s.previewEntries()
	if err != nil {
		return err
	}
	if entriesReferenceAsset(name, entries, previews) {
		return nil
	}
	target, err := s.safePath(name, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return wrap("storage_failed", err)
	}
	return wrap("storage_failed", os.Remove(target))
}
func (s *Service) cachedCatalog() (*Catalog, error) {
	payload, err := s.readFile("catalog.json", maxCatalogBytes)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, wrap("storage_failed", err)
	}
	return parseCatalog(payload)
}
