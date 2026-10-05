package sessionassets

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 材料库目录布局常量（技术方案 §4）。
const (
	manifestFormatVersion = 1
	currentFileName       = "current.json"
	manifestFileName      = "manifest.json"
	assetsDirName         = "assets"
	generationsDirName    = "generations"
	stagingDirName        = "staging"
	derivedDirName        = "derived"
	handoffsDirName       = "handoffs"
	catalogFileName       = "catalog.sqlite"
	catalogLockFileName   = "catalog.lock"
)

// LibraryPaths 解析材料库内的固定位置。root 是材料库根目录。
type LibraryPaths struct {
	Root string
}

// NewLibraryPaths 校验并返回材料库路径集合。
func NewLibraryPaths(root string) (LibraryPaths, error) {
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		return LibraryPaths{}, fmt.Errorf("session assets library root is empty")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return LibraryPaths{}, fmt.Errorf("resolve session assets library root: %w", err)
	}
	return LibraryPaths{Root: filepath.Clean(absolute)}, nil
}

// CatalogPath 返回 catalog.sqlite 路径。
func (p LibraryPaths) CatalogPath() string { return filepath.Join(p.Root, catalogFileName) }

// CatalogLockPath 返回材料库级写入者锁路径。
func (p LibraryPaths) CatalogLockPath() string { return filepath.Join(p.Root, catalogLockFileName) }

// AssetsDir 返回资产根目录。
func (p LibraryPaths) AssetsDir() string { return filepath.Join(p.Root, assetsDirName) }

// StagingDir 返回未提交候选目录。
func (p LibraryPaths) StagingDir() string { return filepath.Join(p.Root, stagingDirName) }

// DerivedDir 返回可重建的派生材料缓存目录。
func (p LibraryPaths) DerivedDir() string { return filepath.Join(p.Root, derivedDirName) }

// HandoffsDir 返回用户主动生成的交接资料目录。
func (p LibraryPaths) HandoffsDir() string { return filepath.Join(p.Root, handoffsDirName) }

// AssetDir 返回单个资产的目录。
func (p LibraryPaths) AssetDir(assetID string) string {
	return filepath.Join(p.AssetsDir(), assetID)
}

// GenerationsDir 返回单个资产的代次目录。
func (p LibraryPaths) GenerationsDir(assetID string) string {
	return filepath.Join(p.AssetDir(assetID), generationsDirName)
}

// GenerationDir 返回单个代次目录。
func (p LibraryPaths) GenerationDir(assetID, generationID string) string {
	return filepath.Join(p.GenerationsDir(assetID), generationID)
}

// CurrentPath 返回单个资产的 latest 指针文件路径。
func (p LibraryPaths) CurrentPath(assetID string) string {
	return filepath.Join(p.AssetDir(assetID), currentFileName)
}

// StagingPath 返回一个保全任务的暂存目录。
func (p LibraryPaths) StagingPath(jobID string) string {
	return filepath.Join(p.StagingDir(), jobID)
}

// newID 生成 128 位随机十六进制 ID，用作集成、来源、资产与任务标识。
func newID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate session assets id: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// newGenerationID 生成代次标识：UTC 时间戳前缀保证目录名有序，随机后缀
// 避免同秒冲突。
func newGenerationID() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate session assets generation id: %w", err)
	}
	return fmt.Sprintf("%013d-%s", time.Now().UTC().UnixNano(), hex.EncodeToString(buf)), nil
}

// ensureDir 创建权限 0700 的目录（材料库可能包含会话敏感内容）。
func ensureDir(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("create session assets directory %s: %w", filepath.Base(path), err)
	}
	return nil
}

// sanitizeID 拒绝含路径分隔符的 ID，防止拼接路径时逃逸资产目录。
func sanitizeID(id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("session assets id is empty")
	}
	if id != filepath.Base(id) || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
		return fmt.Errorf("session assets id %q contains path separators", id)
	}
	return nil
}
