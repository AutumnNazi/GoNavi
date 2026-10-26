package plugin

import "golang.org/x/sys/unix"

func packageAncestorFlags() int {
	return unix.O_PATH | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
}
