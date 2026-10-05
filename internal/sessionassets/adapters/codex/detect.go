// Package codex 实现本机 Codex 的安装探测与只读来源识别。
// 探测只读取目录结构与命令版本证据，不遍历会话正文（技术方案 §3.1）。
package codex

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// 检测状态与原因码。绑定层把它们映射为 i18n 文案，这里保持稳定字符串。
const (
	StatusNotInstalled   = "not_installed"
	StatusNotInitialized = "not_initialized"
	StatusDataUnreadable = "data_unreadable"
	StatusReady          = "ready"

	DetailOK              = "ok"
	DetailCommandMissing  = "command_missing"
	DetailDataDirMissing  = "data_dir_missing"
	DetailDataDirUnreadab = "data_dir_unreadable"
	DetailVersionUnknown  = "version_unknown"

	// versionProbeTimeout 限制 `codex --version` 的等待时间。
	versionProbeTimeout = 3 * time.Second
)

// Detection 是一次探测的完整证据：路径、版本与数据目录可读性。
type Detection struct {
	Kind         string   `json:"kind"`
	Status       string   `json:"status"`
	CommandPath  string   `json:"commandPath"`
	Version      string   `json:"version"`
	DataDir      string   `json:"dataDir"`
	DataReadable bool     `json:"dataReadable"`
	Details      []string `json:"details"`
}

// Detect 探测本机 Codex：显式指定位置优先，其次 PATH 命令，数据目录默认
// CODEX_HOME 或 ~/.codex。不递归遍历用户目录，不运行来源不明的文件。
func Detect(ctx context.Context, explicitCommandPath, explicitDataDir string) Detection {
	detection := Detection{Kind: "codex"}
	commandPath, version, commandErr := resolveCommand(ctx, explicitCommandPath)
	if commandErr == nil {
		detection.CommandPath = commandPath
		detection.Version = version
	} else {
		detection.Details = append(detection.Details, DetailCommandMissing)
		if explicitCommandPath != "" {
			detection.Details = append(detection.Details, DetailVersionUnknown)
		}
	}
	dataDir, dataErr := resolveDataDir(explicitDataDir)
	detection.DataDir = dataDir
	if dataErr != nil {
		detection.Status = detectStatusWithoutData(commandErr == nil)
		detection.Details = append(detection.Details, DetailDataDirMissing)
		return detection
	}
	readable, readErr := probeDataDir(dataDir)
	detection.DataReadable = readable
	switch {
	case readErr == nil && readable:
		detection.Status = StatusReady
		detection.Details = append(detection.Details, DetailOK)
		if version == "" {
			detection.Details = append(detection.Details, DetailVersionUnknown)
		}
	case os.IsNotExist(readErr):
		detection.Status = detectStatusWithoutData(commandErr == nil)
		detection.Details = append(detection.Details, DetailDataDirMissing)
	default:
		detection.Status = StatusDataUnreadable
		detection.Details = append(detection.Details, DetailDataDirUnreadab)
	}
	return detection
}

// detectStatusWithoutData 区分“未安装”与“已安装但未初始化”：只有命令
// 存在而数据目录缺失时才算后者。
func detectStatusWithoutData(commandFound bool) string {
	if commandFound {
		return StatusNotInitialized
	}
	return StatusNotInstalled
}

// resolveCommand 定位命令并取版本证据。显式路径必须存在；PATH 查找失败
// 不再猜测其他安装位置。
func resolveCommand(ctx context.Context, explicitPath string) (string, string, error) {
	if trimmed := strings.TrimSpace(explicitPath); trimmed != "" {
		if _, err := os.Stat(trimmed); err != nil {
			return "", "", fmt.Errorf("codex command not found at %s: %w", trimmed, err)
		}
		version, versionErr := probeVersion(ctx, trimmed)
		return trimmed, version, versionErr
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		if path != "" {
			// Go 的 LookPath 在找到但不可执行时可能同时返回路径与错误。
			return path, "", err
		}
		return "", "", errors.New("codex command not found on PATH")
	}
	version, versionErr := probeVersion(ctx, path)
	return path, version, versionErr
}

// probeVersion 运行 `codex --version` 并解析版本号；失败只影响版本证据。
func probeVersion(ctx context.Context, commandPath string) (string, error) {
	probeCtx, cancel := context.WithTimeout(ctx, versionProbeTimeout)
	defer cancel()
	output, err := exec.CommandContext(probeCtx, commandPath, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("probe codex version: %w", err)
	}
	return normalizeVersion(string(output)), nil
}

// normalizeVersion 从 "codex-cli 0.160.0" 之类的输出中提取版本。
func normalizeVersion(output string) string {
	fields := strings.Fields(strings.TrimSpace(output))
	for _, field := range fields {
		if strings.Contains(field, ".") && field[0] >= '0' && field[0] <= '9' {
			return field
		}
	}
	if len(fields) > 0 {
		return fields[len(fields)-1]
	}
	return ""
}

// resolveDataDir 解析数据目录：显式指定 > CODEX_HOME > ~/.codex。
func resolveDataDir(explicitDir string) (string, error) {
	if trimmed := strings.TrimSpace(explicitDir); trimmed != "" {
		return filepath.Abs(trimmed)
	}
	if envDir := strings.TrimSpace(os.Getenv("CODEX_HOME")); envDir != "" {
		return filepath.Abs(envDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for codex data dir: %w", err)
	}
	return filepath.Join(home, ".codex"), nil
}

// probeDataDir 只读目录名列表验证可读性，不解析任何会话内容。
func probeDataDir(dataDir string) (bool, error) {
	info, err := os.Stat(dataDir)
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, fmt.Errorf("codex data dir %s is not a directory", dataDir)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return false, fmt.Errorf("read codex data dir: %w", err)
	}
	// 触碰一个条目的类型信息，确认目录项元数据可读。
	for _, entry := range entries {
		_ = entry.IsDir()
		break
	}
	return true, nil
}
