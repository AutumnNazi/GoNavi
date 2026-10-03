package aiservice

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
)

// The agent harness hands every provider the desktop's workspace as one generic
// JSON system message. Large models read that fine; the hosted 3B SQL model does
// not: it answered "please provide what you want me to look at" with the selected
// SQL sitting inside the JSON. This provider presents the same facts the way a
// small model reads them: the database, the SQL or schemas the person attached as
// plain fenced text, in the message that carries the question.

// builtinAIPromptProvider wraps the built-in provider for agent runs: the context presented for a
// small model (with the real table names), its short list of tools, and the read-only rule for
// the queries it runs.
type builtinAIPromptProvider struct {
	provider.Provider
	// readOnlyNotice says, in the person's language, why a query was not run.
	readOnlyNotice string
	// tables lists the tables of the person's database (see builtin_ai_tables.go); nil for none.
	tables func(context.Context, builtinAITarget) []string
}

// present is the request as the small model gets it.
func (p builtinAIPromptProvider) present(ctx context.Context, req ai.ChatRequest, target builtinAITarget) ai.ChatRequest {
	tablesLine := ""
	if p.tables != nil {
		tablesLine = builtinAITablesLine(p.tables(ctx, target), target.schemaName)
	}
	req.Messages, req.Tools = presentBuiltinAIContextWithTables(req.Messages, tablesLine), builtinAITools(req.Tools)
	return req
}

func (p builtinAIPromptProvider) Chat(ctx context.Context, req ai.ChatRequest) (*ai.ChatResponse, error) {
	target := builtinAITargetOf(req.Messages)
	req = p.present(ctx, req, target)
	response, err := p.Provider.Chat(ctx, req)
	if response != nil {
		response.ToolCalls, response.Content = guardBuiltinAIToolCalls(target.complete(response.ToolCalls), response.Content, p.readOnlyNotice)
	}
	return response, err
}

func (p builtinAIPromptProvider) ChatStream(ctx context.Context, req ai.ChatRequest, callback func(ai.StreamChunk)) error {
	target := builtinAITargetOf(req.Messages)
	guard := newBuiltinAIStreamGuard(callback, p.readOnlyNotice, target)
	req = p.present(ctx, req, target)
	err := p.Provider.ChatStream(ctx, req, guard.push)
	guard.finish()
	return err
}

// ChatStreamWithState keeps the wrapped provider's session support: the harness
// asks for it by interface.
func (p builtinAIPromptProvider) ChatStreamWithState(ctx context.Context, state json.RawMessage, req ai.ChatRequest, callback func(ai.StreamChunk)) (json.RawMessage, error) {
	target := builtinAITargetOf(req.Messages)
	guard := newBuiltinAIStreamGuard(callback, p.readOnlyNotice, target)
	req = p.present(ctx, req, target)
	defer guard.finish()
	if stateful, ok := p.Provider.(provider.SessionStreamProvider); ok {
		return stateful.ChatStreamWithState(ctx, state, req, guard.push)
	}
	return nil, p.Provider.ChatStream(ctx, req, guard.push)
}

// presentBuiltinAIContext replaces the workspace JSON message, and the standing instructions,
// with readable text merged into the latest user message: a small model follows what sits next
// to the question far better than a separate system message (and the Gateway turns a client's
// system messages into data anyway). Anything it does not recognize is left exactly as it was.
func presentBuiltinAIContext(messages []ai.Message) []ai.Message {
	return presentBuiltinAIContextWithTables(messages, "")
}

// presentBuiltinAIContextWithTables also gives the model the line listing the database's tables.
func presentBuiltinAIContextWithTables(messages []ai.Message, tablesLine string) []ai.Message {
	instructions, rendered := "", ""
	rest := make([]ai.Message, 0, len(messages))
	for _, message := range messages {
		content := strings.TrimSpace(message.Content)
		if message.Role == "system" && strings.HasPrefix(content, runharness.InstructionsHeader) {
			instructions = strings.TrimSpace(strings.TrimPrefix(content, runharness.InstructionsHeader))
			continue
		}
		if message.Role == "system" && strings.HasPrefix(content, `{"kind":"workspace_snapshot"`) {
			var envelope struct {
				Snapshot struct {
					ActiveContext map[string]any `json:"activeContext"`
				} `json:"snapshot"`
			}
			if json.Unmarshal([]byte(message.Content), &envelope) == nil {
				rendered = renderBuiltinAIContext(envelope.Snapshot.ActiveContext, tablesLine)
				continue // nothing the model can use stays out of its small window
			}
		}
		rest = append(rest, message)
	}
	var blocks []string
	if instructions != "" {
		blocks = append(blocks, "### Instructions\n"+instructions)
	}
	if rendered != "" {
		blocks = append(blocks, "### Context\n"+rendered)
	}
	if len(blocks) == 0 {
		return rest
	}
	block := strings.Join(blocks, "\n\n")
	for i := len(rest) - 1; i >= 0; i-- {
		if rest[i].Role == "user" {
			rest[i].Content = block + "\n\n### Request\n" + rest[i].Content
			return rest
		}
	}
	return append([]ai.Message{{Role: "system", Content: block}}, rest...)
}

// renderBuiltinAIContext describes the active database, its tables and what the
// person attached. It returns "" when there is nothing worth telling the model.
func renderBuiltinAIContext(active map[string]any, tablesLine string) string {
	var out []string
	if line := databaseLine(active); line != "" {
		out = append(out, line)
	}
	if tablesLine != "" {
		out = append(out, tablesLine)
	}
	items, _ := active["attachedItems"].([]any)
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if block := renderAttachedItem(item); block != "" {
			out = append(out, block)
		}
	}
	return strings.Join(out, "\n\n")
}

func databaseLine(active map[string]any) string {
	var parts []string
	if name := promptText(active["dbName"]); name != "" {
		parts = append(parts, "Database: "+name)
	}
	// The tools address a database through its saved connection: the model needs the id.
	if id := promptText(active["connectionId"]); id != "" {
		parts = append(parts, "Connection id (for tools): "+id)
	}
	if schema := promptText(active["schemaName"]); schema != "" {
		parts = append(parts, "Schema: "+schema)
	}
	if table := promptText(active["tableName"]); table != "" {
		parts = append(parts, "Selected table: "+table)
	}
	if version := promptText(active["databaseVersion"]); version != "" {
		parts = append(parts, "Version: "+version)
	}
	if constraint := promptText(active["sqlDialectConstraint"]); constraint != "" {
		parts = append(parts, constraint)
	}
	return strings.Join(parts, ". ")
}

func renderAttachedItem(item map[string]any) string {
	if item["kind"] == "chat_quote" {
		body := promptText(item["content"])
		if body == "" {
			return ""
		}
		return "The user is replying to this passage from an earlier answer:\n```\n" + body + "\n```"
	}
	if item["kind"] == "editor_selection" {
		body := promptText(item["content"])
		if body == "" {
			return ""
		}
		heading := "The user selected this code in the SQL editor"
		if label := promptText(item["label"]); label != "" {
			heading += fmt.Sprintf(" (tab %q)", label)
		}
		if source, ok := item["source"].(map[string]any); ok {
			if start, end := promptNumber(source["startLine"]), promptNumber(source["endLine"]); start > 0 && end >= start {
				heading += fmt.Sprintf(", lines %d-%d", start, end)
			}
		}
		return heading + ":\n```sql\n" + body + "\n```"
	}
	ddl := promptText(item["ddl"])
	if ddl == "" {
		return ""
	}
	name := promptText(item["tableName"])
	if db := promptText(item["dbName"]); db != "" && name != "" {
		name = db + "." + name
	}
	return "Table " + name + ":\n```sql\n" + ddl + "\n```"
}

func promptText(value any) string {
	s, _ := value.(string)
	return strings.TrimSpace(s)
}

func promptNumber(value any) int {
	f, _ := value.(float64)
	return int(f)
}
