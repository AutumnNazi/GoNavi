//go:build !windows

package app

import "path/filepath"

func pluginExportFinalPath(path string) (string, error) { return filepath.EvalSymlinks(path) }
