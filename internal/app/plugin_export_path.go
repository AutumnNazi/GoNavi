package app

import (
	"errors"
	"os"
	"path/filepath"
)

// pluginExportCanonicalPath resolves the nearest existing object by filesystem
// identity, then appends only the non-existing suffix. No destination is opened
// for writing, and any error other than absence fails the guard closed.
func pluginExportCanonicalPath(path string) (string, error) {
	absolute, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	suffix := make([]string, 0)
	for current := absolute; ; current = filepath.Dir(current) {
		resolved, err := pluginExportFinalPath(current)
		if err == nil {
			for index := len(suffix) - 1; index >= 0; index-- {
				resolved = filepath.Join(resolved, suffix[index])
			}
			return filepath.Clean(resolved), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append(suffix, filepath.Base(current))
	}
}
