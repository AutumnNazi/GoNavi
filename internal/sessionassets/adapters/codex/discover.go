package codex

import (
	"bufio"
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
	Title        string `json:"title"`
	ProjectDir   string `json:"projectDir"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	CLIVersion   string `json:"cliVersion"`
	Originator   string `json:"originator"`
	EntrySource  string `json:"entrySource"`
	ThreadSource string `json:"threadSource"`
	ForkedFromID string `json:"forkedFromId"`
	ParentThread string `json:"parentThreadId"`
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
		meta.Title = extractSessionTitle(path)
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

// rolloutHeader 对应首行已知字段。逐字段容错提取：单字段类型变化
// （如 source 从字符串变为对象，0.16x 新格式实测）不再导致整个头部
// 解析失败——那会让大量合法会话被误判为损坏（V-17 未知格式降级）。
type rolloutHeader struct {
	Type      string          `json:"type"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

// headerPayload 只声明需要的字段；类型用 RawMessage 以便逐字段容错。
type headerPayload struct {
	SessionID     json.RawMessage `json:"session_id"`
	ID            json.RawMessage `json:"id"`
	Cwd           json.RawMessage `json:"cwd"`
	Originator    json.RawMessage `json:"originator"`
	CLIVersion    json.RawMessage `json:"cli_version"`
	Source        json.RawMessage `json:"source"`
	ThreadSource  json.RawMessage `json:"thread_source"`
	ForkedFromID  json.RawMessage `json:"forked_from_id"`
	ParentThread  json.RawMessage `json:"parent_thread_id"`
	ModelProvider json.RawMessage `json:"model_provider"`
	Model         json.RawMessage `json:"model"`
}

// rawString 提取标量字符串；字段变为对象/数组时回退到其中可读的
// name/id/text 标量，再不行返回空串（绝不因字段形态失败）。
func rawString(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil {
		for _, key := range []string{"name", "id", "label", "text"} {
			if inner, ok := obj[key]; ok {
				if extracted := rawString(inner); extracted != "" {
					return extracted
				}
			}
		}
	}
	return ""
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
	var payload headerPayload
	if len(header.Payload) > 0 {
		if err := json.Unmarshal(header.Payload, &payload); err != nil {
			return SessionMeta{}, fmt.Errorf("decode rollout header payload: %w", err)
		}
	}
	meta.ThreadID = firstNonEmpty(rawString(payload.SessionID), rawString(payload.ID))
	meta.ProjectDir = rawString(payload.Cwd)
	meta.Provider = rawString(payload.Source)
	meta.Model = rawString(payload.Model)
	meta.CLIVersion = rawString(payload.CLIVersion)
	meta.Originator = rawString(payload.Originator)
	meta.EntrySource = rawString(payload.Source)
	meta.ThreadSource = rawString(payload.ThreadSource)
	meta.ForkedFromID = rawString(payload.ForkedFromID)
	meta.ParentThread = rawString(payload.ParentThread)
	if meta.ThreadID == "" {
		return SessionMeta{}, ErrSessionHeaderMissing
	}
	meta.Title = extractSessionTitle(path)
	return meta, nil
}

// titleScanLimit 限制标题扫描的读取量：只看文件开头少量行。
const titleScanLimit = 256 << 10

// extractSessionTitle 从 rollout 开头提取第一条用户消息作为标题
// （只读前 256KB，找不到留空，不猜测）。这是元数据增强，解析失败
// 不影响发现。
func extractSessionTitle(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(io.LimitReader(file, titleScanLimit))
	scanner.Buffer(make([]byte, 0, maxHistoryLineBytes), maxHistoryLineBytes)
	for scanner.Scan() {
		var lineObj rolloutHeader
		if err := json.Unmarshal(scanner.Bytes(), &lineObj); err != nil {
			continue
		}
		if lineObj.Type != "response_item" {
			continue
		}
		var payload struct {
			Type    string          `json:"type"`
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if err := json.Unmarshal(lineObj.Payload, &payload); err != nil {
			continue
		}
		if payload.Type != "message" || payload.Role != "user" {
			continue
		}
		var items []struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(payload.Content, &items); err != nil {
			continue
		}
		for _, item := range items {
			text := strings.TrimSpace(item.Text)
			if text == "" {
				continue
			}
			// 跳过注入的包装：AGENTS.md 指令与环境上下文，取用户真实输入。
			if strings.HasPrefix(text, "# ") || strings.Contains(text, "<INSTRUCTIONS>") || strings.HasPrefix(text, "<environment_context>") {
				continue
			}
			text = strings.ReplaceAll(text, "\n", " ")
			runes := []rune(text)
			if len(runes) > 80 {
				text = string(runes[:80]) + "…"
			}
			return text
		}
	}
	return ""
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
		NativeThreadID:     meta.ThreadID,
		NativePath:         meta.NativePath,
		Archived:           meta.Archived,
		Title:              meta.Title,
		ForkParentThreadID: meta.ParentThread,
		ProjectDir:         meta.ProjectDir,
		Provider:           meta.Provider,
		Model:              meta.Model,
		ModifiedAt:         meta.ModifiedAt,
		Size:               meta.Size,
	}
}
