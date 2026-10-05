package appdata

import (
	"os"
	"path/filepath"
	"strings"
)

// DefaultSessionAssetsDirectory 返回会话资产材料库的默认位置：数据根下的
// session-assets 子目录。数据根本身可被用户重定位，该默认值随之移动。
func DefaultSessionAssetsDirectory(activeRoot string) string {
	root := strings.TrimSpace(activeRoot)
	if root == "" {
		root = MustResolveActiveRoot()
	}
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	return filepath.Join(filepath.Clean(root), sessionAssetsDirectoryName)
}

// ResolveConfiguredSessionAssetsDirectory 读取用户显式配置的材料库位置；
// 未配置时返回空串。
func ResolveConfiguredSessionAssetsDirectory() (string, error) {
	bootstrapConfigMu.Lock()
	cfg, err := readBootstrapConfig()
	bootstrapConfigMu.Unlock()
	if err != nil {
		return "", err
	}
	directory := strings.TrimSpace(cfg.SessionAssetsDirectory)
	if directory == "" {
		return "", nil
	}
	abs, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// ResolveSessionAssetsDirectory 解析材料库实际位置：显式配置优先，否则
// 使用数据根默认值。
func ResolveSessionAssetsDirectory(activeRoot string) (string, error) {
	directory, err := ResolveConfiguredSessionAssetsDirectory()
	if err != nil {
		return "", err
	}
	if directory != "" {
		return directory, nil
	}
	return DefaultSessionAssetsDirectory(activeRoot), nil
}

// SetConfiguredSessionAssetsDirectory 在启用流程中持久化用户选择的位置。
// 只有能承载私有数据的目录才会被接受；空值恢复数据根默认。
func SetConfiguredSessionAssetsDirectory(directory string) (string, error) {
	target := strings.TrimSpace(directory)
	if target != "" {
		abs, err := filepath.Abs(target)
		if err != nil {
			return "", err
		}
		target = filepath.Clean(abs)
		if err := os.MkdirAll(target, 0o700); err != nil {
			return "", err
		}
		probe, err := os.CreateTemp(target, sessionAssetsDirectoryProbePrefix)
		if err != nil {
			return "", err
		}
		probePath := probe.Name()
		if err := probe.Chmod(0o600); err != nil {
			_ = probe.Close()
			_ = os.Remove(probePath)
			return "", err
		}
		if err := probe.Close(); err != nil {
			_ = os.Remove(probePath)
			return "", err
		}
		if err := os.Remove(probePath); err != nil {
			return "", err
		}
	}

	if err := updateBootstrapConfig(func(cfg *bootstrapConfig) {
		cfg.SessionAssetsDirectory = target
	}); err != nil {
		return "", err
	}
	return target, nil
}
