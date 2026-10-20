package aiservice

import (
	"encoding/json"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/connection"
)

const inspectSourceToolName = "inspect_source"

func builtinAIFamilyOf(connections []builtinAIConnection, connectionID string) string {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return ""
	}
	for _, item := range connections {
		if item.ID == connectionID {
			return connection.NonSQLSourceFamily(item.Type)
		}
	}
	return ""
}

func builtinAINonSQLHint(item builtinAIConnection, family string) string {
	base := fmt.Sprintf("Connection %s (%s), id %s, is not SQL. Call inspect_source only, never execute_sql or get_tables.", item.Name, item.Type, item.ID)
	switch family {
	case "nacos":
		return base + " kind=list_namespaces, then list_groups with namespace, then list_entries with namespace and the group the user named, then get_entry with namespace, group and name (dataId)."
	case "redis":
		return base + " kind=list_namespaces for DB indexes, list_entries with namespace set to the DB index and an optional pattern, get_entry with namespace and name (the key)."
	case "vector":
		return base + " kind=list_namespaces for databases, then list_entries with namespace set to the database to list collections."
	case "message":
		return base + " kind=list_entries to list topics or queues."
	default:
		return base
	}
}

func isNonSQLFamily(family string) bool {
	switch family {
	case "nacos", "redis", "vector", "message":
		return true
	default:
		return false
	}
}

func keepInspectSource(tools []ai.Tool) []ai.Tool {
	var kept []ai.Tool
	for _, tool := range tools {
		if strings.TrimSpace(tool.Function.Name) == inspectSourceToolName {
			kept = append(kept, tool)
		}
	}
	return kept
}

func builtinAIInspectOnly(tools []ai.Tool) bool {
	if len(tools) == 0 {
		return false
	}
	for _, tool := range tools {
		if strings.TrimSpace(tool.Function.Name) != inspectSourceToolName {
			return false
		}
	}
	return true
}

func rewriteNonSQLToolCalls(calls []ai.ToolCall) []ai.ToolCall {
	rewritten := make([]ai.ToolCall, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Function.Name)
		switch name {
		case inspectSourceToolName:
			rewritten = append(rewritten, call)
		case "get_databases":
			rewritten = append(rewritten, rewriteInspectCall(call, "list_namespaces", ""))
		case "get_tables", "get_columns", "get_table_ddl", "get_server_version", "execute_sql":
			rewritten = append(rewritten, rewriteInspectCall(call, "list_entries", ""))
		}
	}
	return rewritten
}

func rewriteInspectCall(call ai.ToolCall, kind, namespace string) ai.ToolCall {
	args := map[string]any{}
	if raw := strings.TrimSpace(call.Function.Arguments); raw != "" {
		_ = json.Unmarshal([]byte(raw), &args)
	}
	if args == nil {
		args = map[string]any{}
	}
	if namespace == "" {
		if db, ok := args["dbName"].(string); ok {
			namespace = strings.TrimSpace(db)
		}
	}
	next := map[string]any{"kind": kind}
	if id, ok := args["connectionId"].(string); ok && strings.TrimSpace(id) != "" {
		next["connectionId"] = strings.TrimSpace(id)
	}
	if namespace != "" {
		next["namespace"] = namespace
	}
	if encoded, err := json.Marshal(next); err == nil {
		call.Function.Name = inspectSourceToolName
		call.Function.Arguments = string(encoded)
	}
	return call
}

// builtinAITypeSwitch moves the turn off the selected connection when the person names
// a different database type. One match becomes the target. Several matches are listed
// and calls to the selected connection are refused.
func builtinAITypeSwitch(connections []builtinAIConnection, selectedID, question string) (string, map[string]bool, string, bool) {
	kind, matches := mentionedConnectionsOfType(connections, question)
	if kind == "" || len(matches) == 0 {
		return "", nil, "", false
	}
	selected, selectedOK := builtinAIConnectionByID(connections, selectedID)
	// Nothing is selected: the existing naming path chooses the connection and
	// looks through its databases. Only an already selected connection of a
	// different type needs to be moved aside.
	if !selectedOK {
		return "", nil, "", false
	}
	if strings.EqualFold(selected.Type, matches[0].Type) {
		return "", nil, "", false
	}
	if len(matches) == 1 {
		return matches[0].ID, nil, "", true
	}
	allowed := make(map[string]bool, len(matches))
	parts := make([]string, 0, len(matches))
	for _, item := range matches {
		allowed[item.ID] = true
		parts = append(parts, fmt.Sprintf("%s (id %s)", item.Name, item.ID))
	}
	selectedLabel := "none"
	if selectedOK {
		selectedLabel = fmt.Sprintf("%s (%s, id %s)", selected.Name, selected.Type, selected.ID)
	}
	note := fmt.Sprintf("The selected connection is %s. The user asked for %s instead. Do not call tools on the selected connection. Use one of these connection ids: %s.", selectedLabel, kind, strings.Join(parts, "; "))
	return "", allowed, note, true
}

func mentionedConnectionsOfType(connections []builtinAIConnection, text string) (string, []builtinAIConnection) {
	lower := strings.ToLower(text)
	matched := map[string][]builtinAIConnection{}
	var order []string
	for _, item := range connections {
		kind := strings.ToLower(strings.TrimSpace(item.Type))
		if len(kind) < 4 || !strings.Contains(lower, kind) {
			continue
		}
		if _, seen := matched[kind]; !seen {
			order = append(order, kind)
		}
		matched[kind] = append(matched[kind], item)
	}
	if len(order) != 1 {
		return "", nil
	}
	return order[0], matched[order[0]]
}

func (t builtinAITarget) keepAllowedConnections(calls []ai.ToolCall) ([]ai.ToolCall, string) {
	if len(t.allowedIDs) == 0 {
		return calls, ""
	}
	kept := make([]ai.ToolCall, 0, len(calls))
	rejected := false
	for _, call := range calls {
		id := toolCallConnectionID(call)
		if id != "" && t.allowedIDs[id] {
			kept = append(kept, call)
			continue
		}
		rejected = true
	}
	if !rejected {
		return calls, ""
	}
	note := t.allowedNote
	if note == "" {
		note = "That connection is not the one the user asked for."
	}
	return kept, note
}

func toolCallConnectionID(call ai.ToolCall) string {
	var args struct {
		ConnectionID string `json:"connectionId"`
	}
	_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
	return strings.TrimSpace(args.ConnectionID)
}

func builtinAIConnectionByID(connections []builtinAIConnection, connectionID string) (builtinAIConnection, bool) {
	for _, item := range connections {
		if item.ID == connectionID {
			return item, true
		}
	}
	return builtinAIConnection{}, false
}
