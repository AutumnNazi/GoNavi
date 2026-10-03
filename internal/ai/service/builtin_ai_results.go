package aiservice

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"GoNavi-Wails/internal/ai"
)

// The built-in model is a text-to-SQL model: asked for "some data", it ran the right query and then
// answered with the query again, not with what it returned. So when a turn ends right after a
// query and the answer shows no table, the desktop adds one: the first rows of the result, under a
// line in the person's language saying how many there are.

const (
	builtinAIPreviewRows    = 10
	builtinAIPreviewColumns = 8
	builtinAIPreviewCell    = 40 // runes
)

// builtinAIResultPreview is the table for the query result the request ends with, or "" when it
// does not end with one (or it has no rows).
func builtinAIResultPreview(messages []ai.Message, heading func(shown, total int) string) string {
	if len(messages) == 0 || heading == nil || messages[len(messages)-1].Role != "tool" {
		return ""
	}
	var result struct {
		Results []struct {
			Columns  []string         `json:"columns"`
			RowCount int              `json:"rowCount"`
			Rows     []map[string]any `json:"rows"`
		} `json:"results"`
	}
	decoder := json.NewDecoder(strings.NewReader(messages[len(messages)-1].Content))
	decoder.UseNumber()
	if decoder.Decode(&result) != nil || len(result.Results) == 0 {
		return ""
	}
	set := result.Results[0]
	if len(set.Columns) == 0 || len(set.Rows) == 0 {
		return ""
	}
	columns := set.Columns
	if len(columns) > builtinAIPreviewColumns {
		columns = columns[:builtinAIPreviewColumns]
	}
	shown := min(len(set.Rows), builtinAIPreviewRows)
	total := max(set.RowCount, len(set.Rows))

	var b strings.Builder
	b.WriteString(heading(shown, total))
	b.WriteString("\n\n|")
	for _, column := range columns {
		b.WriteString(" " + previewCell(column) + " |")
	}
	b.WriteString("\n|")
	for range columns {
		b.WriteString(" --- |")
	}
	for _, row := range set.Rows[:shown] {
		b.WriteString("\n|")
		for _, column := range columns {
			b.WriteString(" " + previewCell(row[column]) + " |")
		}
	}
	return b.String()
}

func previewCell(value any) string {
	var text string
	switch v := value.(type) {
	case nil:
		text = "NULL"
	case string:
		text = v
	default:
		text = fmt.Sprint(v)
	}
	text = strings.NewReplacer("|", `\|`, "\r\n", " ", "\n", " ", "\r", " ").Replace(text)
	if utf8.RuneCountInString(text) > builtinAIPreviewCell {
		text = string([]rune(text)[:builtinAIPreviewCell]) + "…"
	}
	return text
}

// showsTable reports whether an answer already shows a markdown table.
func showsTable(text string) bool {
	return strings.Contains(text, "|---") || strings.Contains(text, "| ---") || strings.Contains(text, "|:--")
}
