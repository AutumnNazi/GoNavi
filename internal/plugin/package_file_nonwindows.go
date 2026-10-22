//go:build !windows

package plugin

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/unix"
)

func canonicalPackageDirectory(path string) (string, error) { return filepath.EvalSymlinks(path) }

func canonicalStorageRoot(path string) (string, error) {
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	canonical := filepath.Join(parent, filepath.Base(path))
	directory, err := openPackageDirectory(context.Background(), canonical)
	if err != nil {
		return "", err
	}
	if err = directory.Close(); err != nil {
		return "", err
	}
	return canonical, nil
}

func openPackageVolumeRoot(path string, readContent bool) (*os.File, error) {
	flags := packageAncestorFlags()
	if readContent {
		flags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
	}
	fd, err := unix.Open(path, flags, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

func openPackageChildHandle(parent *os.File, name string, readContent bool) (*os.File, error) {
	flags := packageAncestorFlags()
	if readContent {
		flags = unix.O_RDONLY | unix.O_NONBLOCK | unix.O_NOFOLLOW | unix.O_CLOEXEC
	}
	fd, err := unix.Openat(int(parent.Fd()), name, flags, 0)
	runtime.KeepAlive(parent)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), filepath.Join(parent.Name(), name))
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	var stat unix.Stat_t
	if err = unix.Fstat(fd, &stat); err != nil {
		file.Close()
		return nil, err
	}
	if (!info.IsDir() && !info.Mode().IsRegular()) || (info.Mode().IsRegular() && stat.Nlink != 1) {
		file.Close()
		return nil, fmt.Errorf("package contains link or special file")
	}
	return file, nil
}
