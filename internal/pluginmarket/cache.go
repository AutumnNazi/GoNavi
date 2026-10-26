package pluginmarket

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxCachePages = 16

type cacheEntry struct {
	SourceID string      `json:"sourceId"`
	Query    string      `json:"query"`
	Page     CatalogPage `json:"page"`
}

func (s *Service) cachePath(source sourceSnapshot, query string) string {
	return filepath.Join(s.root, "cache", sourceID(source.id+"\n"+query)+".json")
}

func (s *Service) cachePage(source sourceSnapshot, query string, page CatalogPage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkSourceLocked(source); err != nil {
		return err
	}
	directory := filepath.Join(s.root, "cache")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("create marketplace cache: %w", err)
	}
	entry := cacheEntry{SourceID: source.id, Query: query, Page: page}
	encoded, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("encode marketplace cache: %w", err)
	}
	if len(encoded) > maxJSONBytes+4096 {
		return ErrResponseTooLarge
	}
	if err = atomicJSON(s.cachePath(source, query), entry, maxJSONBytes+4096); err != nil {
		return err
	}
	return pruneCache(directory)
}

func (s *Service) cachedFallback(source sourceSnapshot, query string, fetchErr error) (CatalogPage, error) {
	empty := CatalogPage{Items: []Item{}, SourceID: source.id, Error: errorCode(fetchErr)}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkSourceLocked(source); err != nil {
		return CatalogPage{Items: []Item{}, Error: errorCode(err)}, err
	}
	encoded, err := readBoundedFile(s.cachePath(source, query), maxJSONBytes+4096)
	if errors.Is(err, os.ErrNotExist) {
		return empty, fetchErr
	}
	if err != nil {
		return empty, errors.Join(fetchErr, fmt.Errorf("read marketplace cache: %w", err))
	}
	var entry cacheEntry
	if json.Unmarshal(encoded, &entry) != nil || entry.SourceID != source.id || entry.Query != query || entry.Page.CachedAt == nil ||
		entry.Page.CachedAt.IsZero() || validatePage(&entry.Page, source) != nil {
		return empty, errors.Join(fetchErr, ErrInvalidResponse)
	}
	entry.Page.Stale = true
	entry.Page.Error = errorCode(fetchErr)
	return entry.Page, fetchErr
}

func pruneCache(directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("list marketplace cache: %w", err)
	}
	type cacheFile struct {
		name     string
		modified time.Time
	}
	files := make([]cacheFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !digestPattern.MatchString(strings.TrimSuffix(entry.Name(), ".json")) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("inspect marketplace cache: %w", err)
		}
		files = append(files, cacheFile{name: entry.Name(), modified: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for len(files) > maxCachePages {
		if err = os.Remove(filepath.Join(directory, files[0].name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("evict marketplace cache: %w", err)
		}
		files = files[1:]
	}
	return nil
}
