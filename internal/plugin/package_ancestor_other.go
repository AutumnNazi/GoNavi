//go:build !windows && !linux && !darwin

package plugin

import "golang.org/x/sys/unix"

func packageAncestorFlags() int {
	return unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
}
