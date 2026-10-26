package plugin

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// openPackageDirectory traverses an already-canonical absolute path without following links.
func openPackageDirectory(ctx context.Context, path string) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, fmt.Errorf("package root must be canonical and absolute")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	volume := filepath.VolumeName(path)
	base := volume + string(filepath.Separator)
	relative := strings.TrimPrefix(path, base)
	if path == volume {
		relative = ""
	}
	current, err := openPackageVolumeRoot(base, relative == "")
	if err != nil {
		return nil, err
	}
	if relative == "" {
		return current, nil
	}
	parts := strings.Split(relative, string(filepath.Separator))
	for index, name := range parts {
		if err = ctx.Err(); err != nil {
			current.Close()
			return nil, err
		}
		next, openErr := openPackageChild(current, name, index == len(parts)-1)
		current.Close()
		if openErr != nil {
			return nil, openErr
		}
		info, statErr := next.Stat()
		if statErr != nil {
			next.Close()
			return nil, statErr
		}
		if !info.IsDir() {
			next.Close()
			return nil, fmt.Errorf("package ancestor is not a directory")
		}
		current = next
	}
	return current, nil
}

func openPackageChild(parent *os.File, name string, readContent bool) (*os.File, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\:\x00") {
		return nil, fmt.Errorf("unsafe package child component")
	}
	return openPackageChildHandle(parent, name, readContent)
}

func (s *packageScan) directoryHandle(directory *os.File, prefix string) error {
	for {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		names, readErr := directory.Readdirnames(64)
		for _, name := range names {
			relative := name
			if prefix != "" {
				relative = prefix + "/" + name
			}
			if err := safePackagePath(relative); err != nil {
				return err
			}
			if s.entries >= maxPackageEntries {
				return fmt.Errorf("package contains too many entries")
			}
			if err := s.directoryChild(directory, name, relative); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return fmt.Errorf("read package directory failed")
		}
	}
}

func (s *packageScan) directoryChild(parent *os.File, name, relative string) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	file, err := openPackageChild(parent, name, true)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err == nil {
		if info.IsDir() {
			err = s.entry(relative, true)
			if err == nil {
				err = s.directoryHandle(file, relative)
			}
		} else {
			err = s.file(relative, info.Size(), file)
		}
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
