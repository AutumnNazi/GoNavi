package main

import (
	"errors"
	"path/filepath"
	"sort"
	"strings"
)

func publicPackageError(err error, paths ...string) error {
	if err == nil {
		return nil
	}
	candidates := make([]string, 0, len(paths)*2)
	for _, path := range paths {
		if path == "" {
			continue
		}
		candidates = append(candidates, path)
		if absolute, absErr := filepath.Abs(path); absErr == nil {
			candidates = append(candidates, absolute)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return len(candidates[i]) > len(candidates[j]) })
	text := err.Error()
	for _, path := range candidates {
		text = strings.ReplaceAll(text, path, "package")
	}
	return errors.New(text)
}
