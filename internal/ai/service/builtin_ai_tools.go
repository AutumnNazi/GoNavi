package aiservice

import (
	"encoding/json"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/safety"
)

// The built-in AI runs a 3B model on a small server, so it gets a short list of read-only tools:
// enough to see what is in the user's database and look at some rows, few enough that the model
// picks the right one and the definitions cost little prompt-reading time. Everything else in
// GoNavi's tool catalog stays with the large models. The Gateway only recognizes calls to tools
// offered in the request, so the model cannot reach the others either.
var builtinAIToolNames = map[string]bool{
	"get_server_version": true,
	"get_databases":      true,
	"get_tables":         true,
	"get_columns":        true,
	"get_table_ddl":      true,
	"execute_sql":        true,
}

const builtinAIExecuteSQLDescription = "Run one read-only query (SELECT, SHOW, DESCRIBE or EXPLAIN) on a saved connection and return the rows. Add LIMIT to queries that may return many rows. Statements that change data or schema are refused."

// builtinAITools keeps the curated tools, in the catalog's order, and offers execute_sql as the
// read-only query it is for this model.
func builtinAITools(tools []ai.Tool) []ai.Tool {
	var kept []ai.Tool
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Function.Name)
		if !builtinAIToolNames[name] {
			continue
		}
		if name == "execute_sql" {
			tool.Function.Description = builtinAIExecuteSQLDescription
			tool.Function.Parameters = map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"connectionId", "sql"},
				"properties": map[string]any{
					"connectionId": map[string]any{"type": "string", "description": "saved connection ID"},
					"dbName":       map[string]any{"type": "string", "description": "optional database or schema"},
					"sql":          map[string]any{"type": "string", "description": "one read-only SQL statement"},
				},
			}
		}
		kept = append(kept, tool)
	}
	return kept
}

// guardBuiltinAIToolCalls lets through the calls the built-in AI may make. A query that is not
// read-only is not run: the person gets the SQL to look at instead, with a note that says why.
// (The tool's own checks and the approval step stay in place for everything that passes.)
func guardBuiltinAIToolCalls(calls []ai.ToolCall, content string, notice string) ([]ai.ToolCall, string) {
	var allowed []ai.ToolCall
	var blocked []string
	for _, call := range calls {
		name := strings.TrimSpace(call.Function.Name)
		if !builtinAIToolNames[name] {
			continue
		}
		if name == "execute_sql" {
			var args struct {
				SQL string `json:"sql"`
			}
			_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
			if sql := strings.TrimSpace(args.SQL); sql == "" || safety.ClassifySQL(sql) != ai.SQLOpQuery {
				blocked = append(blocked, sql)
				continue
			}
		}
		allowed = append(allowed, call)
	}
	if len(blocked) == 0 {
		return allowed, content
	}
	var text strings.Builder
	if strings.TrimSpace(content) != "" {
		text.WriteString(strings.TrimRight(content, "\n"))
		text.WriteString("\n\n")
	}
	text.WriteString(notice)
	for _, sql := range blocked {
		if sql != "" {
			text.WriteString("\n\n```sql\n" + sql + "\n```")
		}
	}
	return allowed, text.String()
}

// builtinAIStreamGuard holds a streamed answer's tool calls until it ends: the provider reports
// the calls as they build up, and only the complete ones can be judged. They are then passed on,
// or (for a refused query) replaced by the note.
type builtinAIStreamGuard struct {
	callback func(ai.StreamChunk)
	notice   string
	calls    []ai.ToolCall
	released bool
}

func newBuiltinAIStreamGuard(callback func(ai.StreamChunk), notice string) *builtinAIStreamGuard {
	return &builtinAIStreamGuard{callback: callback, notice: notice}
}

func (g *builtinAIStreamGuard) push(chunk ai.StreamChunk) {
	if len(chunk.ToolCalls) > 0 {
		g.calls = append([]ai.ToolCall(nil), chunk.ToolCalls...)
		chunk.ToolCalls = nil
		if chunk.Content == "" && chunk.ReasoningContent == "" && chunk.Thinking == "" && !chunk.Done && chunk.Error == "" && chunk.Usage == nil {
			return
		}
	}
	if chunk.Done || chunk.Error != "" {
		g.release()
	}
	g.callback(chunk)
}

// finish releases what is still held if the provider stopped without a final chunk.
func (g *builtinAIStreamGuard) finish() { g.release() }

func (g *builtinAIStreamGuard) release() {
	if g.released || len(g.calls) == 0 {
		return
	}
	g.released = true
	allowed, text := guardBuiltinAIToolCalls(g.calls, "", g.notice)
	if text != "" {
		g.callback(ai.StreamChunk{Content: text})
	}
	if len(allowed) > 0 {
		g.callback(ai.StreamChunk{ToolCalls: allowed})
	}
}
