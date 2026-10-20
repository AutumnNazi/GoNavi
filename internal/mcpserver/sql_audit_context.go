package mcpserver

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"

	"GoNavi-Wails/internal/sqlaudit"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func withSQLAuditContext(ctx context.Context, req *mcp.CallToolRequest) (context.Context, string) {
	requestID := mcpRequestID(ctx)
	if requestID == "" {
		requestID = uuid.NewString()
	}
	return sqlaudit.WithMCPContext(ctx, sqlaudit.MCPContext{RequestID: requestID, Client: mcpAuditClient(req)}), requestID
}

func mcpAuditClient(req *mcp.CallToolRequest) string {
	if req == nil || req.Session == nil {
		return ""
	}
	params := req.Session.InitializeParams()
	if params == nil || params.ClientInfo == nil {
		return ""
	}
	session := req.Session.ID()
	// HTTP 会话标识和客户端声明均只落指纹，不存认证令牌。stdio 无会话 ID，使用进程边界区分。
	if session == "" {
		session = fmt.Sprintf("stdio:%d:%d", os.Getpid(), os.Getppid())
	}
	return fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(params.ClientInfo.Name+"\x00"+params.ClientInfo.Version+"\x00"+session)))
}
