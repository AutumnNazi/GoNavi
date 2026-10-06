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

// ScanQuality 区分扫描完整性：错误必须显式返回，调用方据此决定能否
// 把消失的引用推断为明确删除（V-22：不可达不误报删除）。
const (
	ScanComplete    = "complete"    // 关键目录全部可读
	ScanPartial     = "partial"     // 部分目录/文件不可读，发现结果不完整
	ScanUnreachable = "unreachable" // 来源根或归档目录整体不可达
)

// DiscoverSessions 扫描数据目录下的活跃与归档会话。返回扫描质量：
// complete=关键目录全部可读；partial=个别目录不可读但来源根可达；
// unreachable=来源根或归档目录整体不可达（权限、挂载、移动）。
// 单个文件解析失败只计入 broken，不影响扫描质量。
func DiscoverSessions(ctx context.Context, dataDir string) ([]SessionMeta, []string, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, ScanUnreachable, err
	}
	if info, err := os.Stat(dataDir); err != nil || !info.IsDir() {
		// 来源根整体不可达：不产生任何删除推断。
		return nil, nil, ScanUnreachable, nil
	}
	metas := make([]SessionMeta, 0, 16)
	broken := make([]string, 0)
	quality := ScanComplete
	archivedDir := filepath.Join(dataDir, archivedSessionsDirName)
	archivedMeta, archivedBroken, archivedErr := discoverRolloutDir(ctx, archivedDir, true)
	if archivedErr != nil {
		if !errors.Is(archivedErr, os.ErrNotExist) {
			// 权限或 IO 错误：归档目录整体不可读。
			return metas, broken, ScanUnreachable, nil
		}
		// 归档目录不存在属合法布局（无归档）；活跃目录也缺失则视为不可达。
		if _, activeStatErr := os.Stat(filepath.Join(dataDir, activeSessionsDirName)); activeStatErr != nil {
			return nil, archivedBroken, ScanUnreachable, nil
		}
		quality = ScanPartial
	}
	metas = append(metas, archivedMeta...)
	broken = append(broken, archivedBroken...)
	activeRoot := filepath.Join(dataDir, activeSessionsDirName)
	activeFiles, walkErr := collectRolloutFiles(ctx, activeRoot, 4)
	if walkErr != nil {
		if errors.Is(walkErr, os.ErrNotExist) {
			// 活跃目录缺失：无活跃发现，不降低扫描质量。
			sort.Slice(metas, func(i, j int) bool { return metas[i].ModifiedAt > metas[j].ModifiedAt })
			return metas, broken, quality, nil
		}
		quality = ScanPartial
	} else {
		for _, path := range activeFiles {
			if err := ctx.Err(); err != nil {
				return metas, broken, quality, err
			}
			meta, err := readSessionHeader(path, false)
			if err != nil {
				broken = append(broken, path)
				continue
			}
			metas = append(metas, meta)
		}
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].ModifiedAt > metas[j].ModifiedAt })
	return metas, broken, quality, nil
}

// discoverRolloutDir 读取扁平的归档目录。目录不存在返回 os.ErrNotExist，
// 其它错误（权限、IO）原样返回，调用方区分扫描质量。
func discoverRolloutDir(ctx context.Context, dir string, archived bool) ([]SessionMeta, []string, error) {
	files, err := collectRolloutFiles(ctx, dir, 1)
	if err != nil {
		return nil, nil, err
	}
	metas := make([]SessionMeta, 0, len(files))
	broken := make([]string, 0)
	for _, path := range files {
		if err := ctx.Err(); err != nil {
			return metas, broken, err
		}
		meta, err := readSessionHeader(path, archived)
		if err != nil {
			broken = append(broken, path)
			continue
		}
		metas = append(metas, meta)
	}
	return metas, broken, nil
}

// collectRolloutFiles 收集目录（至多 depth 层）内的 rollout 文件。
// 目录不存在返回包装的 os.ErrNotExist；权限/IO 错误原样返回。
func collectRolloutFiles(ctx context.Context, root string, maxDepth int) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	files := make([]string, 0, 16)
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("read codex sessions directory %s: %w", filepath.Base(root), os.ErrNotExist)
		}
		return nil, fmt.Errorf("read codex sessions directory: %w", err)
	}
	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if maxDepth <= 1 {
				continue
			}
			nested, err := collectRolloutFiles(ctx, path, maxDepth-1)
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
// err 非 nil 表示扫描被取消或发生致命错误；扫描质量通过 Quality 表达。
func (Discoverer) DiscoverSourceSessions(ctx context.Context, dataDir string) (sessionassets.SourceScanResult, error) {
	metas, broken, quality, err := DiscoverSessions(ctx, dataDir)
	if err != nil {
		return sessionassets.SourceScanResult{Quality: sessionassets.ScanQualityUnreachable}, err
	}
	sessions := make([]sessionassets.DiscoveredSession, 0, len(metas))
	for _, meta := range metas {
		sessions = append(sessions, toDiscovered(meta))
	}
	return sessionassets.SourceScanResult{
		Sessions: sessions,
		Broken:   broken,
		Quality:  quality,
		Complete: quality == ScanComplete,
	}, nil
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
