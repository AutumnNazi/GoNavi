//go:build unix

package sessionassets

import (
	"fmt"
	"os"
)

// syncDir 尽力把目录项变更落盘（Unix 需要，Windows 不支持目录句柄同步）。
func syncDir(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open directory for sync: %w", err)
	}
	if err := dir.Sync(); err != nil {
		_ = dir.Close()
		return fmt.Errorf("sync directory: %w", err)
	}
	return dir.Close()
}
