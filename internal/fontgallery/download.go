package fontgallery

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"os"
	"path/filepath"

	"GoNavi-Wails/internal/logger"
)

// Download commits verified font bytes and offline rights metadata before success.
func (s *Service) Download(ctx context.Context, id, version string, onProgress func(Progress)) (Installed, error) {
	if !validIdentity(id, version, false) {
		return Installed{}, failure("invalid_id", "invalid id or version")
	}
	if err := ctx.Err(); err != nil {
		return Installed{}, err
	}
	if existing, err := s.resolveContext(ctx, id, version); err == nil {
		emitProgress(onProgress, existing.Entry.Font.SizeBytes, existing.Entry.Font.SizeBytes, "complete")
		return existing, nil
	}
	entry, err := s.catalogEntry(ctx, id, version)
	if err != nil {
		return Installed{}, err
	}
	cached, err := s.registerCachedAsset(ctx, entry, entry.Font, "installed.json")
	if err != nil {
		return Installed{}, err
	}
	if cached {
		emitProgress(onProgress, entry.Font.SizeBytes, entry.Font.SizeBytes, "complete")
		return installation(entry), nil
	}
	if err := s.acquire(ctx); err != nil {
		return Installed{}, err
	}
	defer func() { <-s.slots }()
	temp, err := s.downloadAsset(ctx, entry.Font, onProgress)
	if err != nil {
		return Installed{}, err
	}
	defer removeTemporary(temp)
	emitProgress(onProgress, entry.Font.SizeBytes, entry.Font.SizeBytes, "installing")
	err = s.transactionContext(ctx, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return s.commitInstallation(temp, entry)
	})
	if err != nil {
		return Installed{}, err
	}
	emitProgress(onProgress, entry.Font.SizeBytes, entry.Font.SizeBytes, "complete")
	return installation(entry), nil
}

// Preview downloads a verified preview asset without installing the full font.
func (s *Service) Preview(ctx context.Context, id, version string, onProgress func(Progress)) (Previewed, error) {
	if !validIdentity(id, version, false) {
		return Previewed{}, failure("invalid_id", "invalid id or version")
	}
	entry, err := s.catalogEntry(ctx, id, version)
	if err != nil {
		return Previewed{}, err
	}
	if cached, err := s.cachedPreview(ctx, entry); err == nil {
		emitProgress(onProgress, entry.Preview.SizeBytes, entry.Preview.SizeBytes, "complete")
		return cached, nil
	}
	cached, err := s.registerCachedAsset(ctx, entry, entry.Preview, "previews.json")
	if err != nil {
		return Previewed{}, err
	}
	if cached {
		emitProgress(onProgress, entry.Preview.SizeBytes, entry.Preview.SizeBytes, "complete")
		return previewed(entry), nil
	}
	if err := s.acquire(ctx); err != nil {
		return Previewed{}, err
	}
	defer func() { <-s.slots }()
	temp, err := s.downloadAsset(ctx, entry.Preview, onProgress)
	if err != nil {
		return Previewed{}, err
	}
	defer removeTemporary(temp)
	err = s.transactionContext(ctx, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return s.commitPreview(temp, entry)
	})
	if err != nil {
		return Previewed{}, err
	}
	emitProgress(onProgress, entry.Preview.SizeBytes, entry.Preview.SizeBytes, "complete")
	return previewed(entry), nil
}

func (s *Service) catalogEntry(ctx context.Context, id, version string) (Entry, error) {
	var entry Entry
	err := s.snapshotContext(ctx, func() error {
		catalog, err := s.cachedCatalog()
		if err != nil {
			return err
		}
		if catalog == nil {
			return failure("unavailable", "no cached catalog")
		}
		var found bool
		entry, found = selectEntry(catalog.Entries, id, version)
		if !found {
			return failure("unavailable", "entry is absent from catalog")
		}
		return nil
	})
	return entry, err
}
func emitProgress(callback func(Progress), downloaded, total int64, phase string) {
	if callback != nil {
		callback(Progress{Downloaded: downloaded, Total: total, Phase: phase})
	}
}
func removeTemporary(path string) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.Error(err, "font gallery temporary cleanup failed")
	}
}
func (s *Service) downloadAsset(ctx context.Context, a Asset, callback func(Progress)) (string, error) {
	resp, err := s.request(ctx, a.Path)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	contentType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || !mimeMatches(contentType, a.MIMEType) || resp.ContentLength >= 0 && resp.ContentLength != a.SizeBytes {
		return "", failure("integrity", "font response mime or length mismatch")
	}
	target, err := s.safePath(a.Path, true)
	if err != nil {
		return "", wrap("storage_failed", err)
	}
	file, err := os.CreateTemp(filepath.Dir(target), ".font-gallery-*")
	if err != nil {
		return "", wrap("storage_failed", err)
	}
	complete := false
	defer func() {
		if !complete {
			removeTemporary(file.Name())
		}
	}()
	emitProgress(callback, 0, a.SizeBytes, "downloading")
	err = streamAsset(ctx, file, io.LimitReader(resp.Body, a.SizeBytes+1), a, callback)
	if err != nil {
		return "", errors.Join(err, wrap("storage_failed", file.Close()))
	}
	if err := file.Sync(); err != nil {
		return "", wrap("storage_failed", errors.Join(err, file.Close()))
	}
	if err := file.Close(); err != nil {
		return "", wrap("storage_failed", err)
	}
	emitProgress(callback, a.SizeBytes, a.SizeBytes, "verifying")
	payload, err := s.readFile("assets/"+filepath.Base(file.Name()), maxFontBytes)
	if err != nil {
		return "", wrap("storage_failed", err)
	}
	if err := verifyFont(payload, a); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	complete = true
	return file.Name(), nil
}
func mimeMatches(got, want string) bool {
	if got == want {
		return true
	}
	switch want {
	case "font/ttf":
		return got == "application/font-sfnt" || got == "application/x-font-ttf" || got == "font/sfnt"
	case "font/otf":
		return got == "application/font-sfnt" || got == "application/vnd.ms-opentype"
	case "font/woff2":
		return got == "application/font-woff2"
	}
	return false
}
func streamAsset(ctx context.Context, file *os.File, reader io.Reader, a Asset, callback func(Progress)) error {
	hash := sha256.New()
	buffer := make([]byte, 32<<10)
	var downloaded int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := reader.Read(buffer)
		if err := ctx.Err(); err != nil {
			return err
		}
		if n > 0 {
			downloaded += int64(n)
			if downloaded > a.SizeBytes {
				return failure("integrity", "font exceeds declared size")
			}
			if _, err := file.Write(buffer[:n]); err != nil {
				return wrap("storage_failed", err)
			}
			if _, err := hash.Write(buffer[:n]); err != nil {
				return wrap("integrity", err)
			}
			emitProgress(callback, downloaded, a.SizeBytes, "downloading")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return wrap("download_failed", readErr)
		}
	}
	if downloaded != a.SizeBytes || hex.EncodeToString(hash.Sum(nil)) != a.SHA256 {
		return failure("integrity", "font size or hash mismatch")
	}
	return nil
}
