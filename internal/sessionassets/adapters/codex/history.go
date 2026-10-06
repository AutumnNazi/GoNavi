package codex

import (
	"GoNavi-Wails/internal/sessionassets"

	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// 历史阅读的解析边界：只抽取可解释的部分（消息、成对工具调用、摘要），
// 加密与未知记录保留在原始材料中，不猜测、不伪解码（V-17）。
const (
	// maxHistoryLineBytes 防御单行异常膨胀；内嵌图片等大行在此上限内
	// 仍可解析，超出按不透明条目处理。
	maxHistoryLineBytes = 32 << 20
)

// 历史条目类型（进入前端只读渲染）。
const (
	HistoryKindMessage   = "message"
	HistoryKindToolCall  = "tool_call"
	HistoryKindToolOut   = "tool_output"
	HistoryKindReasoning = "reasoning"
	HistoryKindEvent     = "event"
	HistoryKindSystem    = "system"
	HistoryKindOpaque    = "opaque"
)

// HistoryEntry 是一条按需读取的可读历史条目。Text 为空且 Opaque 为真
// 表示该行无法解释为文本，需要走原始材料查看。
type HistoryEntry struct {
	Index     int    `json:"index"`
	Kind      string `json:"kind"`
	Role      string `json:"role,omitempty"`
	Name      string `json:"name,omitempty"`
	CallID    string `json:"callId,omitempty"`
	Text      string `json:"text,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
	Opaque    bool   `json:"opaque"`
}

// HistoryPage 是一页历史与游标：hasMore 为假表示已到文件尾。
type HistoryPage struct {
	Entries    []HistoryEntry `json:"entries"`
	NextOffset int            `json:"nextOffset"`
	HasMore    bool           `json:"hasMore"`
}

// historyLine 对应 rollout 行的已知字段；未知字段忽略。
type historyLine struct {
	Type      string          `json:"type"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

type historyPayload struct {
	Type             string          `json:"type"`
	Role             string          `json:"role"`
	Name             string          `json:"name"`
	CallID           string          `json:"call_id"`
	Input            json.RawMessage `json:"input"`
	Arguments        json.RawMessage `json:"arguments"`
	Output           json.RawMessage `json:"output"`
	Summary          json.RawMessage `json:"summary"`
	Content          json.RawMessage `json:"content"`
	EncryptedContent string          `json:"encrypted_content"`
	ID               string          `json:"id"`
}

// ReadHistoryPage 按条目分页读取 rollout 的可读历史。offset/limit 以
// 文件行（含首行元数据）为单位；读取是流式的，不整份载入文件。
func ReadHistoryPage(ctx context.Context, path string, offset, limit int) (HistoryPage, error) {
	if offset < 0 || limit <= 0 {
		return HistoryPage{}, errors.New("invalid history page range")
	}
	file, err := os.Open(path)
	if err != nil {
		return HistoryPage{}, fmt.Errorf("open rollout for reading: %w", err)
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	page := HistoryPage{Entries: make([]HistoryEntry, 0, limit)}
	index := 0
	for index < offset {
		if err := ctx.Err(); err != nil {
			return page, err
		}
		if err := skipLine(reader); err != nil {
			if errors.Is(err, io.EOF) {
				return page, nil
			}
			return page, err
		}
		index++
	}
	for len(page.Entries) < limit {
		if err := ctx.Err(); err != nil {
			return page, err
		}
		line, readErr := readLineLimited(reader)
		if len(line) == 0 && readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return page, nil
			}
			return page, readErr
		}
		entry, parseErr := parseHistoryLine(index, line)
		if parseErr == nil {
			page.Entries = append(page.Entries, entry)
		}
		index++
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return page, nil
			}
			return page, readErr
		}
	}
	page.NextOffset = index
	page.HasMore = true
	return page, nil
}

// parseHistoryLine 把一行 rollout 转为可读条目；无法解释的行按不透明
// 计数，不产生伪造内容。
func parseHistoryLine(index int, line []byte) (HistoryEntry, error) {
	var lineObj historyLine
	if err := json.Unmarshal(line, &lineObj); err != nil {
		return HistoryEntry{Index: index, Kind: HistoryKindOpaque, Opaque: true}, nil
	}
	entry := HistoryEntry{Index: index, Timestamp: lineObj.Timestamp}
	switch lineObj.Type {
	case sessionMetaLineType:
		entry.Kind = HistoryKindSystem
		entry.Text = ""
		return entry, nil
	case "response_item", "event_msg", "turn_context", "world_state":
	default:
		entry.Kind = HistoryKindOpaque
		entry.Opaque = true
		return entry, nil
	}
	var payload historyPayload
	if err := json.Unmarshal(lineObj.Payload, &payload); err != nil {
		entry.Kind = HistoryKindOpaque
		entry.Opaque = true
		return entry, nil
	}
	switch payload.Type {
	case "message":
		entry.Kind = HistoryKindMessage
		entry.Role = payload.Role
		entry.Text = extractContentText(payload.Content)
		if strings.TrimSpace(entry.Role) == "developer" {
			entry.Kind = HistoryKindSystem
		}
	case "custom_tool_call", "function_call":
		entry.Kind = HistoryKindToolCall
		entry.Name = payload.Name
		entry.CallID = payload.CallID
		entry.Text = rawJSONText(firstNonEmptyRaw(payload.Input, payload.Arguments))
	case "custom_tool_call_output", "function_call_output":
		entry.Kind = HistoryKindToolOut
		entry.CallID = payload.CallID
		entry.Text = rawJSONText(payload.Output)
	case "reasoning":
		entry.Kind = HistoryKindReasoning
		entry.Text = extractContentText(payload.Summary)
		entry.Opaque = strings.TrimSpace(payload.EncryptedContent) != ""
	case "task_started", "task_complete", "token_count", "item_completed", "thread_settings_applied":
		entry.Kind = HistoryKindEvent
		entry.Text = payload.Type
	default:
		entry.Kind = HistoryKindOpaque
		entry.Opaque = true
	}
	return entry, nil
}

// extractContentText 从 content/summary 数组抽取 text 字段；非文本元素
// 用占位说明，不丢弃也不伪造。
func extractContentText(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var items []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return ""
	}
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if strings.Contains(item.Type, "text") && strings.TrimSpace(item.Text) != "" {
			parts = append(parts, item.Text)
			continue
		}
		parts = append(parts, "["+nonEmpty(item.Type, "non-text")+"]")
	}
	return strings.Join(parts, "\n")
}

func firstNonEmptyRaw(values ...json.RawMessage) json.RawMessage {
	for _, value := range values {
		if len(strings.TrimSpace(string(value))) > 0 {
			return value
		}
	}
	return nil
}

func rawJSONText(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	// 整体为 JSON 字符串时展示其内容（工具输出常见形态）；其余 JSON
	// 原样保留，不做猜测性转换。
	var decoded string
	if err := json.Unmarshal(raw, &decoded); err == nil {
		return decoded
	}
	return trimmed
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// readLineLimited 读取一行，超限的部分被丢弃并返回当前截断行。
func readLineLimited(reader *bufio.Reader) ([]byte, error) {
	var collected []byte
	for {
		chunk, err := reader.ReadSlice('\n')
		collected = append(collected, chunk...)
		if err == bufio.ErrBufferFull {
			if len(collected) > maxHistoryLineBytes {
				// 丢弃余下部分直到行尾，行按不透明处理。
				for {
					discard, err := reader.ReadSlice('\n')
					if err != nil {
						return collected, err
					}
					_ = discard
				}
			}
			continue
		}
		return collected, err
	}
}

func skipLine(reader *bufio.Reader) error {
	_, err := readLineLimited(reader)
	return err
}

// HistoryStats 是一次范围预览的统计：条目数、可读消息数、成对工具
// 记录数与不透明条目数。用于两阶段交接的预览（不估算 token）。
type HistoryStats struct {
	TotalLines   int  `json:"totalLines"`
	Messages     int  `json:"messages"`
	ToolCalls    int  `json:"toolCalls"`
	ToolOutputs  int  `json:"toolOutputs"`
	Opaque       int  `json:"opaque"`
	LastUserLine int  `json:"lastUserLine"`
	Truncated    bool `json:"truncated"`
}

// ScanHistoryStats 完整流过文件统计各类型条目；LastUserLine 是最后一条
// user 消息所在行（“最近可读轮次”的起点，-1 表示没有）。
func ScanHistoryStats(ctx context.Context, path string) (HistoryStats, error) {
	stats := HistoryStats{LastUserLine: -1}
	file, err := os.Open(path)
	if err != nil {
		return stats, fmt.Errorf("open rollout for stats: %w", err)
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	index := 0
	for {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		line, readErr := readLineLimited(reader)
		if len(line) > 0 {
			entry, parseErr := parseHistoryLine(index, line)
			if parseErr == nil {
				stats.TotalLines++
				switch entry.Kind {
				case HistoryKindMessage:
					stats.Messages++
					if entry.Role == "user" {
						stats.LastUserLine = index
					}
				case HistoryKindToolCall:
					stats.ToolCalls++
				case HistoryKindToolOut:
					stats.ToolOutputs++
				case HistoryKindOpaque:
					stats.Opaque++
				}
			}
		}
		index++
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return stats, nil
			}
			return stats, readErr
		}
		if index > 4_000_000 {
			// 防御异常膨胀的文件：标记截断而非静默成功（V-23）。
			stats.Truncated = true
			return stats, nil
		}
	}
}

// ReadableHistoryAdapter 把 rollout 历史转换为领域层可读条目接口实现。
type ReadableHistoryAdapter struct{}

// ReadReadablePage 实现 sessionassets.ReadableHistoryReader。
func (ReadableHistoryAdapter) ReadReadablePage(ctx context.Context, path string, offset, limit int) ([]sessionassets.ReadableEntry, int, bool, error) {
	page, err := ReadHistoryPage(ctx, path, offset, limit)
	if err != nil {
		return nil, 0, false, err
	}
	entries := make([]sessionassets.ReadableEntry, 0, len(page.Entries))
	for _, entry := range page.Entries {
		entries = append(entries, sessionassets.ReadableEntry{
			Index:  entry.Index,
			Kind:   entry.Kind,
			Role:   entry.Role,
			Name:   entry.Name,
			Text:   entry.Text,
			Opaque: entry.Opaque,
		})
	}
	return entries, page.NextOffset, page.HasMore, nil
}

// ScanReadableStats 实现 sessionassets.HistoryStatsScanner。
func (ReadableHistoryAdapter) ScanReadableStats(ctx context.Context, path string) (sessionassets.HistoryStatsView, error) {
	stats, err := ScanHistoryStats(ctx, path)
	if err != nil {
		return sessionassets.HistoryStatsView{}, err
	}
	return sessionassets.HistoryStatsView{
		TotalLines:   stats.TotalLines,
		Messages:     stats.Messages,
		ToolCalls:    stats.ToolCalls,
		ToolOutputs:  stats.ToolOutputs,
		Opaque:       stats.Opaque,
		LastUserLine: stats.LastUserLine,
		Truncated:    stats.Truncated,
	}, nil
}
