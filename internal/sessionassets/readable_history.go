package sessionassets

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// ReadableEntry 是跨适配器的可读历史条目视图；adapter 把工具私有格式
// 转换为该结构，无法解释的内容以 Opaque 标记，不伪造文本。
type ReadableEntry struct {
	Index int    `json:"index"`
	Kind  string `json:"kind"`
	Role  string `json:"role,omitempty"`
	Name  string `json:"name,omitempty"`
	Text  string `json:"text,omitempty"`
	Opaque bool  `json:"opaque"`
}

// ReadableHistoryReader 按行分页读取可读历史（消费方定义的接口，
// adapter 实现）。行序与工具原始文件一致，Index 是稳定游标。
type ReadableHistoryReader interface {
	ReadReadablePage(ctx context.Context, path string, offset, limit int) (entries []ReadableEntry, nextOffset int, hasMore bool, err error)
}

// WriteReadableMarkdown 把 [from,to] 行范围（含端点；to<0 表示到末尾）
// 的可读条目写成 Markdown 引用资料。长历史流式写出，不整份载入。
func WriteReadableMarkdown(ctx context.Context, reader ReadableHistoryReader, path, target string, from, to int, header map[string]string) error {
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create readable export: %w", err)
	}
	writer := bufio.NewWriter(file)
	defer func() { _ = file.Close() }()
	fmt.Fprintf(writer, "# %s\n\n", header["title"])
	for _, key := range []string{"thread", "provider", "project", "readSource", "coverage", "scope"} {
		if value := header[key]; value != "" {
			fmt.Fprintf(writer, "- %s: %s\n", key, value)
		}
	}
	writer.WriteString("\n---\n\n")
	offset := 0
	const pageSize = 200
	for {
		entries, next, hasMore, err := reader.ReadReadablePage(ctx, path, offset, pageSize)
		if err != nil {
			_ = file.Close()
			return fmt.Errorf("read history for export: %w", err)
		}
		for _, entry := range entries {
			if entry.Index < from || (to >= 0 && entry.Index > to) {
				continue
			}
			writeReadableEntryMarkdown(writer, entry)
		}
		if !hasMore {
			break
		}
		offset = next
	}
	if err := writer.Flush(); err != nil {
		_ = file.Close()
		return fmt.Errorf("flush readable export: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync readable export: %w", err)
	}
	return file.Close()
}

func writeReadableEntryMarkdown(writer *bufio.Writer, entry ReadableEntry) {
	if entry.Kind == "system" && strings.TrimSpace(entry.Text) == "" {
		return
	}
	label := entryLabelFor(entry)
	writer.WriteString("### " + label + "\n\n")
	if entry.Opaque {
		writer.WriteString("[opaque entry; see raw material]\n\n")
		return
	}
	if strings.TrimSpace(entry.Text) == "" {
		writer.WriteString("(empty)\n\n")
		return
	}
	writer.WriteString(entry.Text)
	writer.WriteString("\n\n")
}

func entryLabelFor(entry ReadableEntry) string {
	label := entry.Kind
	if entry.Role != "" {
		label += "/" + entry.Role
	}
	if entry.Name != "" {
		label += "/" + entry.Name
	}
	return label
}

// FormatCoverageTime 是覆盖时间的统一展示格式（界面直接引用）。
func FormatCoverageTime(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).Format("2006-01-02 15:04")
}
