package aiservice

import (
	"fmt"
	"os"
	"path/filepath"
)

// mcpConfigTempFile 抽象临时文件生命周期，供故障注入测试替换。
type mcpConfigTempFile interface {
	Chmod(mode os.FileMode) error
	Write(p []byte) (int, error)
	Sync() error
	Close() error
	Name() string
}

// 测试注入点：默认走真实实现；测试替换后必须恢复原值。
// 依赖包级状态的测试不得使用 t.Parallel，否则注入会互相污染。
var (
	mcpConfigCreateTempFile = func(dir string, pattern string) (mcpConfigTempFile, error) {
		return os.CreateTemp(dir, pattern)
	}
	mcpConfigReplace = replaceMCPConfigFile
)

// writeMCPConfigFileAtomically 以同目录临时文件加原子替换更新配置文件。
// chmod、写、sync、close、替换任一步失败时，正式配置字节保持不变，临时文件被清理；
// 符号链接写入解析后的目标文件；已存在文件保留原权限，新文件 0o644。
// 注意：Chmod 显式设定权限、不受 umask 约束（与既有 OpenCode 链路行为一致）。
func writeMCPConfigFileAtomically(configPath string, payload []byte) error {
	writePath := configPath
	if info, err := os.Lstat(configPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		resolvedPath, err := filepath.EvalSymlinks(configPath)
		if err != nil {
			return err
		}
		writePath = resolvedPath
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(writePath); err == nil {
		mode = info.Mode().Perm()
	}
	temp, err := mcpConfigCreateTempFile(filepath.Dir(writePath), ".gonavi-mcp-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(mode); err != nil {
		_ = temp.Close()
		return err
	}
	written, err := temp.Write(payload)
	if err != nil {
		_ = temp.Close()
		return err
	}
	// io.Writer 允许短写且返回 nil error，必须显式校验，否则截断内容会通过 Sync 进入替换
	if written != len(payload) {
		_ = temp.Close()
		return fmt.Errorf("mcp config short write: %d of %d bytes", written, len(payload))
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return mcpConfigReplace(tempPath, writePath)
}
