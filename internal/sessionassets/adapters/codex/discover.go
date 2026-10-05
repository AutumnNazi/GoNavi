package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"GoNavi-Wails/internal/sessionassets"
)

// Codex 0.160 本机实测（Windows）的 rollout 布局：
//
//	sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl   活跃会话
//	archived_sessions/rollout-<timestamp>-<uuid>.jsonl     归档会话
//
// 首行 {"type":"session_meta","payload":{...}} 携带 thread 元数据；
// 其余行为 event_msg / response_item / turn_context / world_state。
// 未知类型与字段原样保留在材料中，读取层只抽取可解释的元数据。

const (
	activeSessionsDirName   = "sessions"
	archivedSessionsDirName = "archived_sessions"
	rolloutFilePrefix       = "rollout-"
	rolloutFileSuffix       = ".jsonl"
	sessionMetaLineType     = "session_meta"
	// headerReadLimit 限制头部读取量：元数据在首行，不解析正文。
	headerReadLimit = 1 << 20
)

// 解析错误与来源缺失分开，便于把“个别文件损坏”与“来源不可达”区分开。
var (
	ErrSessionHeaderMissing = errors.New("rollout session_meta header is missing")
)

// SessionMeta 是一次只读发现得到的会话元信息。取不到的字段留空，
// 不从文件名猜测（需求 §4.2）。
type SessionMeta struct {
	ThreadID     string `json:"threadId"`
	NativePath   string `json:"nativePath"`
	Archived     bool   `json:"archived"`
	ProjectDir   string `json:"projectDir"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	CLIVersion   string `json:"cliVersion"`
	Originator   string `json:"originator"`
	EntrySource  string `json:"entrySource"`
	ThreadSource string `json:"threadSource"`
	ModifiedAt   int64  `json:"modifiedAt"`
	Size         int64  `json:"size"`
}

// DiscoverSessions 扫描数据目录下的活跃与归档会话。单个文件解析失败
// 不中断整体发现；损坏文件由调用方按来源状态呈现。
func DiscoverSessions(_ context.Context, dataDir string) ([]SessionMeta, []string, error) {
	metas := make([]SessionMeta, 0, 16)
	broken := make([]string, 0)
	archivedDir := filepath.Join(dataDir, archivedSessionsDirName)
	metasFromFile, brokenFromFile := discoverRolloutDir(archivedDir, true)
	metas = append(metas, metasFromFile...)
	broken = append(broken, brokenFromFile...)
	activeRoot := filepath.Join(dataDir, activeSessionsDirName)
	activeFiles, walkErr := collectRolloutFiles(activeRoot, 4)
	if walkErr != nil {
		return metas, broken, nil // 活跃目录缺失只影响活跃发现，不视为来源错误
	}
	for _, path := range activeFiles {
		meta, err := readSessionHeader(path, false)
		if err != nil {
			broken = append(broken, path)
			continue
		}
		metas = append(metas, meta)
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].ModifiedAt > metas[j].ModifiedAt })
	return metas, broken, nil
}

// discoverRolloutDir 读取扁平的归档目录。
func discoverRolloutDir(dir string, archived bool) ([]SessionMeta, []string) {
	files, err := collectRolloutFiles(dir, 1)
	if err != nil {
		return nil, nil
	}
	metas := make([]SessionMeta, 0, len(files))
	broken := make([]string, 0)
	for _, path := range files {
		meta, err := readSessionHeader(path, archived)
		if err != nil {
			broken = append(broken, path)
			continue
		}
		metas = append(metas, meta)
	}
	return metas, broken
}

// collectRolloutFiles 收集目录（至多 depth 层）内的 rollout 文件。
func collectRolloutFiles(root string, maxDepth int) ([]string, error) {
	files := make([]string, 0, 16)
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, err
		}
		return nil, fmt.Errorf("read codex sessions directory: %w", err)
	}
	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if maxDepth <= 1 {
				continue
			}
			nested, err := collectRolloutFiles(path, maxDepth-1)
			if err != nil {
				continue
			}
			files = append(files, nested...)
			continue
		}
		if strings.HasPrefix(entry.Name(), rolloutFilePrefix) && strings.HasSuffix(entry.Name(), rolloutFileSuffix) {
			files = append(files, path)
		}
	}
	return files, nil
}

// rolloutHeader 对应首行已知字段；未知字段由 encoding/json 忽略并原样
// 保留在原始材料中。
type rolloutHeader struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Payload   struct {
		SessionID     string `json:"session_id"`
		ID            string `json:"id"`
		Timestamp     string `json:"timestamp"`
		Cwd           string `json:"cwd"`
		Originator    string `json:"originator"`
		CLIVersion    string `json:"cli_version"`
		Source        string `json:"source"`
		ThreadSource  string `json:"thread_source"`
		ModelProvider string `json:"model_provider"`
		Model         string `json:"model"`
	} `json:"payload"`
}

// readSessionHeader 只读取文件头部第一段有效 JSON 行。
func readSessionHeader(path string, archived bool) (SessionMeta, error) {
	meta := SessionMeta{NativePath: path, Archived: archived}
	info, err := os.Stat(path)
	if err != nil {
		return SessionMeta{}, fmt.Errorf("stat rollout file: %w", err)
	}
	meta.ModifiedAt = info.ModTime().Unix()
	meta.Size = info.Size()
	file, err := os.Open(path)
	if err != nil {
		return SessionMeta{}, fmt.Errorf("open rollout file: %w", err)
	}
	defer file.Close()
	reader := io.LimitReader(file, headerReadLimit)
	decoder := json.NewDecoder(reader)
	var header rolloutHeader
	if err := decoder.Decode(&header); err != nil {
		return SessionMeta{}, fmt.Errorf("decode rollout header: %w", err)
	}
	if header.Type != sessionMetaLineType {
		return SessionMeta{}, ErrSessionHeaderMissing
	}
	meta.ThreadID = firstNonEmpty(header.Payload.SessionID, header.Payload.ID)
	meta.ProjectDir = header.Payload.Cwd
	meta.Provider = header.Payload.ModelProvider
	meta.Model = header.Payload.Model
	meta.CLIVersion = header.Payload.CLIVersion
	meta.Originator = header.Payload.Originator
	meta.EntrySource = header.Payload.Source
	meta.ThreadSource = header.Payload.ThreadSource
	if meta.ThreadID == "" {
		return SessionMeta{}, ErrSessionHeaderMissing
	}
	return meta, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// Discoverer 实现 sessionassets.SourceDiscoverer：把 rollout 元数据转换
// 为领域通用结构。
type Discoverer struct{}

// DiscoverSourceSessions 扫描数据目录的全部活跃与归档会话。
func (Discoverer) DiscoverSourceSessions(ctx context.Context, dataDir string) ([]sessionassets.DiscoveredSession, []string, error) {
	metas, broken, err := DiscoverSessions(ctx, dataDir)
	if err != nil {
		return nil, broken, err
	}
	sessions := make([]sessionassets.DiscoveredSession, 0, len(metas))
	for _, meta := range metas {
		sessions = append(sessions, toDiscovered(meta))
	}
	return sessions, broken, nil
}

// DiscoverSession 解析单个 rollout 文件。
func (Discoverer) DiscoverSession(_ context.Context, path string, archived bool) (sessionassets.DiscoveredSession, error) {
	meta, err := readSessionHeader(path, archived)
	if err != nil {
		return sessionassets.DiscoveredSession{}, err
	}
	return toDiscovered(meta), nil
}

func toDiscovered(meta SessionMeta) sessionassets.DiscoveredSession {
	return sessionassets.DiscoveredSession{
		NativeThreadID: meta.ThreadID,
		NativePath:     meta.NativePath,
		Archived:       meta.Archived,
		ProjectDir:     meta.ProjectDir,
		Provider:       meta.Provider,
		Model:          meta.Model,
		ModifiedAt:     meta.ModifiedAt,
		Size:           meta.Size,
	}
}
