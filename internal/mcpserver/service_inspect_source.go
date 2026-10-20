package mcpserver

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/ai/runharness"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const inspectSourceToolName = "inspect_source"

type inspectSourceArgs struct {
	ConnectionID string `json:"connectionId"`
	Kind         string `json:"kind,omitempty"`
	Namespace    string `json:"namespace,omitempty"`
	Group        string `json:"group,omitempty"`
	Name         string `json:"name,omitempty"`
	Pattern      string `json:"pattern,omitempty"`
}

type inspectSourceResult struct {
	ConnectionID string `json:"connectionId"`
	Type         string `json:"type"`
	Family       string `json:"family"`
	Kind         string `json:"kind"`
	Data         any    `json:"data,omitempty"`
}

type sourceInspectBackend interface {
	InspectSource(context.Context, connection.ConnectionConfig, appcore.SourceInspectQuery) connection.QueryResult
}

func (b *AppBackend) InspectSource(ctx context.Context, config connection.ConnectionConfig, query appcore.SourceInspectQuery) connection.QueryResult {
	if b == nil || b.app == nil {
		return connection.QueryResult{Success: false, Message: "应用未就绪"}
	}
	return b.app.InspectSource(ctx, config, query)
}

func (s *Service) InspectSource(ctx context.Context, _ *mcp.CallToolRequest, args inspectSourceArgs) (*mcp.CallToolResult, inspectSourceResult, error) {
	view, errResult := s.resolveConnection(args.ConnectionID)
	if errResult != nil {
		return errResult, inspectSourceResult{}, nil
	}
	inspector, ok := s.backend.(sourceInspectBackend)
	if !ok {
		return toolError("当前后端不能查看 Nacos、Redis、向量库或消息连接"), inspectSourceResult{}, nil
	}
	family := connection.NonSQLSourceFamily(view.Config.Type)
	query := appcore.SourceInspectQuery{
		Kind:      args.Kind,
		Namespace: args.Namespace,
		Group:     args.Group,
		Name:      args.Name,
		Pattern:   args.Pattern,
	}
	result := inspector.InspectSource(ctx, view.Config, query)
	if !result.Success {
		return toolError("%s", strings.TrimSpace(result.Message)), inspectSourceResult{}, nil
	}
	return successResult(), inspectSourceResult{
		ConnectionID: view.ID,
		Type:         strings.TrimSpace(view.Config.Type),
		Family:       family,
		Kind:         strings.TrimSpace(query.Kind),
		Data:         result.Data,
	}, nil
}

func (e *agentToolExecutor) executeInspectSource(ctx context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	var args inspectSourceArgs
	if err := decodeAgentToolArguments(request.Arguments, &args); err != nil {
		return failedAgentToolResult("malformed_tool_call"), err
	}
	return e.call(ctx, func() (*mcp.CallToolResult, any, error) {
		result, output, err := e.catalog.service.InspectSource(ctx, nil, args)
		return result, output, err
	})
}

func inspectSourceDescriptor() runharness.ToolDescriptor {
	return runharness.ToolDescriptor{
		Name: inspectSourceToolName,
		Description: "Read a saved Nacos, Redis, vector database (Milvus, Chroma, Qdrant) or message broker (MQTT, Kafka, RocketMQ, RabbitMQ, Pulsar). " +
			"Do not use this for SQL databases. kind is list_namespaces, list_groups, list_entries or get_entry. " +
			"namespace is a Nacos namespace, Redis DB index or vector database. group is a Nacos group. " +
			"name is a Nacos dataId, Redis key, collection or topic. pattern limits Redis keys.",
		InputSchema: schemaObject([]string{"connectionId"}, map[string]any{
			"connectionId": schemaString("saved connection ID"),
			"kind":         schemaString("list_namespaces, list_groups, list_entries or get_entry"),
			"namespace":    schemaString("Nacos namespace, Redis DB index, or vector database"),
			"group":        schemaString("Nacos group"),
			"name":         schemaString("Nacos dataId, Redis key, collection or topic"),
			"pattern":      schemaString("optional Redis key pattern, default *"),
		}),
		Effect:         runharness.ToolEffectReadOnly,
		Capabilities:   []string{"database", "metadata"},
		MaxResultBytes: 1 << 20,
	}
}
