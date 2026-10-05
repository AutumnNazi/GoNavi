//go:build windows

package sessionassets

// syncDir 在 Windows 上是空操作：目录项变更依赖 NTFS 日志，关键提交
// （current 指针）已通过 MOVEFILE_WRITE_THROUGH 的原子替换保证持久序。
func syncDir(string) error { return nil }
