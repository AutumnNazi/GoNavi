package sessionagent

// 本文件是 Codex 会话扫描与元数据提取。规则参考 cc-switch
// session_manager/providers/codex.rs：列表只读 head/tail 少量行，
// 标题双来源（state_5.sqlite threads 表 + session_index.jsonl）。

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

const (
	codexProviderID = "codex"
	// codexTitleMaxChars 线程标题的截断长度。
	codexTitleMaxChars = 200
)

// uuidRe 从文件名兜底提取会话 ID。
var uuidRe = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)

// CodexSessionRoots 返回 Codex 会话目录（sessions + archived_sessions）。
func CodexSessionRoots(dataDir string) []string {
	if strings.TrimSpace(dataDir) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil
		}
		dataDir = filepath.Join(home, ".codex")
	}
	return []string{
		filepath.Join(dataDir, "sessions"),
		filepath.Join(dataDir, "archived_sessions"),
	}
}

// codexParseCache 是列表级增量缓存（mtime+len 判活）。
var codexParseCache = NewFileParseCache()

// ScanCodexSessions 扫描 Codex 数据目录的全部会话记录，按最后活跃
// 时间倒序返回。titles 为空时从数据目录读取标题来源。
func ScanCodexSessions(dataDir string) []SessionMeta {
	roots := CodexSessionRoots(dataDir)
	var files []string
	for _, root := range roots {
		files = append(files, CollectRolloutFiles(root)...)
	}
	if len(files) == 0 {
		return nil
	}
	titles := loadCodexThreadTitles(dataDir)
	metas := codexParseCache.Scan(files, func(path string) (*SessionMeta, error) {
		return parseCodexSessionMeta(path, titles)
	})
	result := make([]SessionMeta, 0, len(metas))
	for _, meta := range metas {
		result = append(result, *meta)
	}
	sortSessionsDesc(result)
	return result
}

// sortSessionsDesc 按最后活跃时间倒序（缺失按 0）。
func sortSessionsDesc(sessions []SessionMeta) {
	for i := 1; i < len(sessions); i++ {
		for j := i; j > 0 && sessionTime(sessions[j]) > sessionTime(sessions[j-1]); j-- {
			sessions[j], sessions[j-1] = sessions[j-1], sessions[j]
		}
	}
}

func sessionTime(meta SessionMeta) int64 {
	if meta.LastActiveAt > 0 {
		return meta.LastActiveAt
	}
	return meta.CreatedAt
}

// rolloutLine 是 rollout 行的最小结构（头尾扫描只看少量字段）。
type rolloutLine struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type rolloutSessionMeta struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	Cwd       string `json:"cwd"`
	Timestamp any    `json:"timestamp"`
	Source    *struct {
		Subagent *bool `json:"subagent"`
	} `json:"source"`
}

// parseCodexSessionMeta 从 rollout 文件提取列表元数据：只读 head/tail
// 少量行。取不到的字段留空，不从文件名猜测（ID 例外：UUID 兜底）。
func parseCodexSessionMeta(path string, titles map[string]string) (*SessionMeta, error) {
	lines, err := ReadHeadTailLines(path)
	if err != nil {
		return nil, err
	}

	meta := &SessionMeta{
		ProviderID:    codexProviderID,
		SourcePath:    path,
		ResumeCommand: "",
	}

	// head 解析：session_meta + 首条真实用户消息。
	for _, line := range lines.Head {
		var item rolloutLine
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			continue
		}
		if item.Type != "session_meta" {
			continue
		}
		var payload rolloutSessionMeta
		if err := json.Unmarshal(item.Payload, &payload); err != nil {
			continue
		}
		if payload.Source != nil && payload.Source.Subagent != nil && *payload.Source.Subagent {
			// 子代理线程不进列表。
			return nil, nil
		}
		meta.SessionID = firstNonEmpty(payload.ID, payload.SessionID)
		meta.ProjectDir = strings.TrimSpace(payload.Cwd)
		meta.CreatedAt = ParseTimestampMs(payload.Timestamp)
		break
	}
	if meta.SessionID == "" {
		// 文件名 UUID 兜底。
		meta.SessionID = uuidRe.FindString(filepath.Base(path))
	}
	if meta.SessionID == "" {
		return nil, nil
	}
	meta.ResumeCommand = "codex resume " + meta.SessionID

	// 首条真实用户消息 → FirstMessage 与标题候选。
	for _, line := range lines.Head {
		if text := codexUserMessageText(line); text != "" {
			meta.FirstMessage = TruncateRunes(FoldWhitespace(text), SummaryChars)
			meta.Title = TruncateRunes(text, codexTitleMaxChars)
			break
		}
	}

	// tail 解析：最后活跃时间 + 摘要。
	for i := len(lines.Tail) - 1; i >= 0; i-- {
		var item rolloutLine
		if err := json.Unmarshal([]byte(lines.Tail[i]), &item); err != nil {
			continue
		}
		var payload struct {
			Timestamp any    `json:"timestamp"`
			Type      string `json:"type"`
			Role      string `json:"role"`
			Content   []struct {
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(item.Payload, &payload); err == nil && item.Type == "response_item" {
			if meta.Summary == "" && payload.Type == "message" && payload.Role != "" {
				for _, c := range payload.Content {
					text := strings.TrimSpace(c.Text)
					if text == "" {
						continue
					}
					meta.Summary = TruncateRunes(FoldWhitespace(text), SummaryChars)
					break
				}
			}
		}
		// 时间戳：行自带 timestamp 优先。
		var tsLine struct {
			Timestamp any `json:"timestamp"`
		}
		if err := json.Unmarshal([]byte(lines.Tail[i]), &tsLine); err == nil && meta.LastActiveAt == 0 {
			if ts := ParseTimestampMs(tsLine.Timestamp); ts > 0 {
				meta.LastActiveAt = ts
			}
		}
	}
	if meta.LastActiveAt == 0 {
		meta.LastActiveAt = lines.FallbackLastActive
	}

	// 标题优先级：线程表 → 首条用户消息（已有）→ 项目目录名。
	if title := titles[meta.SessionID]; title != "" {
		meta.Title = TruncateRunes(title, codexTitleMaxChars)
	}
	if meta.Title == "" && meta.ProjectDir != "" {
		meta.Title = TruncateRunes(PathBasename(meta.ProjectDir), codexTitleMaxChars)
	}
	return meta, nil
}

// codexUserMessageText 从一行提取真实用户输入（跳过注入包装）。
func codexUserMessageText(line string) string {
	var item rolloutLine
	if err := json.Unmarshal([]byte(line), &item); err != nil {
		return ""
	}
	if item.Type != "response_item" {
		return ""
	}
	var payload struct {
		Type    string `json:"type"`
		Role    string `json:"role"`
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(item.Payload, &payload); err != nil {
		return ""
	}
	if payload.Type != "message" || payload.Role != "user" {
		return ""
	}
	for _, c := range payload.Content {
		text := strings.TrimSpace(c.Text)
		if text == "" || isInjectedUserText(text) {
			continue
		}
		return FoldWhitespace(text)
	}
	return ""
}

// isInjectedUserText 判断用户消息是否为工具注入的包装（与 rollout
// 解析共享同一清单）。
func isInjectedUserText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "# AGENTS.md instructions") ||
		(strings.HasPrefix(trimmed, "# ") && strings.Contains(trimmed, "AGENTS.md")) {
		return true
	}
	if strings.HasPrefix(trimmed, "<environment_context>") ||
		strings.HasPrefix(trimmed, "<user_instructions>") ||
		strings.HasPrefix(trimmed, "<turn_aborted>") {
		return true
	}
	// 单标签包裹（recommended_plugins、in-app-browser-context 等）：
	// 标签名取到首个空白或 > 为止，防属性里的 > 干扰（如 source="x">）。
	if strings.HasPrefix(trimmed, "<image") {
		return true
	}
	if strings.HasPrefix(trimmed, "<") {
		rest := trimmed[1:]
		nameEnd := len(rest)
		for i := 0; i < len(rest); i++ {
			if rest[i] == ' ' || rest[i] == '\t' || rest[i] == '>' || rest[i] == '/' {
				nameEnd = i
				break
			}
		}
		name := rest[:nameEnd]
		if name != "" && strings.Contains(trimmed, "</"+name+">") {
			return true
		}
	}
	return false
}

// ─── 标题双来源 ───

// codexTitlesMu 保护标题缓存（每次扫描重读，按需加锁）。
var codexTitlesMu sync.Mutex

// loadCodexThreadTitles 合并两个标题来源（DB 覆盖 index）：
// session_index.jsonl（每 id 末条胜）+ state_5.sqlite threads 表
// （仅用户显式改过名的行）。来源读取失败时返回空表，不中断扫描。
func loadCodexThreadTitles(dataDir string) map[string]string {
	codexTitlesMu.Lock()
	defer codexTitlesMu.Unlock()

	titles := map[string]string{}
	if strings.TrimSpace(dataDir) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return titles
		}
		dataDir = filepath.Join(home, ".codex")
	}

	// 来源一：session_index.jsonl。
	if file, err := os.Open(filepath.Join(dataDir, "session_index.jsonl")); err == nil {
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
		for scanner.Scan() {
			var entry struct {
				ID         string `json:"id"`
				ThreadName string `json:"thread_name"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
				continue
			}
			name := strings.TrimSpace(entry.ThreadName)
			if entry.ID != "" && name != "" {
				titles[entry.ID] = name
			}
		}
		file.Close()
	}

	// 来源二：state_5.sqlite threads 表（只取显式改名的行，DB 覆盖
	// index）。Codex 持写锁，这里只读 + busy_timeout 短超时。
	dbPath := filepath.Join(dataDir, "state_5.sqlite")
	if _, err := os.Stat(dbPath); err == nil {
		db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro&_pragma=busy_timeout(2000)&_pragma=query_only(1)")
		if err == nil {
			rows, err := db.Query(`SELECT id, title FROM threads
				WHERE title <> ''
				  AND (first_user_message IS NULL OR TRIM(title) <> TRIM(first_user_message))`)
			if err == nil {
				for rows.Next() {
					var id, title string
					if rows.Scan(&id, &title) == nil && strings.TrimSpace(title) != "" {
						titles[id] = strings.TrimSpace(title)
					}
				}
				rows.Close()
			}
			db.Close()
		}
	}
	return titles
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
