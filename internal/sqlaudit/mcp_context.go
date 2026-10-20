package sqlaudit

import "context"

type mcpContextKey struct{}

// MCPContext 保存请求追踪标识，不包含认证令牌或连接信息。
type MCPContext struct {
	RequestID string
	Client    string
}

// WithMCPContext 将 MCP 请求追踪信息传递到审计边界。
func WithMCPContext(ctx context.Context, metadata MCPContext) context.Context {
	return context.WithValue(ctx, mcpContextKey{}, metadata)
}

// MCPContextFrom 读取当前请求的审计上下文。
func MCPContextFrom(ctx context.Context) MCPContext {
	if ctx == nil {
		return MCPContext{}
	}
	metadata, _ := ctx.Value(mcpContextKey{}).(MCPContext)
	return metadata
}

// ApplyMCPContext 只为 MCP 来源事件附加请求上下文。
func ApplyMCPContext(event Event, metadata MCPContext) Event {
	if event.Source == "mcp" {
		event.MCPRequestID = metadata.RequestID
		event.MCPClient = metadata.Client
	}
	return event
}
