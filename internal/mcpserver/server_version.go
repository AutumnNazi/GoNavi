package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type getServerVersionResult struct {
	ConnectionID string `json:"connectionId"`
	Type         string `json:"type,omitempty"`
	Version      string `json:"version,omitempty"`
	Available    bool   `json:"available"`
	Message      string `json:"message,omitempty"`
}

func (s *Service) GetServerVersion(ctx context.Context, req *mcp.CallToolRequest, args connectionIDArgs) (*mcp.CallToolResult, getServerVersionResult, error) {
	_ = req

	view, errResult := s.resolveConnection(args.ConnectionID)
	if errResult != nil {
		return errResult, getServerVersionResult{}, nil
	}

	queryResult := s.backend.DBGetServerVersion(ctx, view.Config)
	version := strings.TrimSpace(queryResult.Message)
	if version == "" {
		version = firstNamedString(queryResult.Data, "version", "Version")
	}
	if !queryResult.Success {
		return toolError("获取数据库版本失败: %s", strings.TrimSpace(queryResult.Message)), getServerVersionResult{
			ConnectionID: view.ID,
			Type:         strings.TrimSpace(view.Config.Type),
			Available:    false,
			Message:      strings.TrimSpace(queryResult.Message),
		}, nil
	}

	return successResult(), getServerVersionResult{
		ConnectionID: view.ID,
		Type:         strings.TrimSpace(view.Config.Type),
		Version:      version,
		Available:    version != "",
		Message:      strings.TrimSpace(queryResult.Message),
	}, nil
}

func firstNamedString(data interface{}, keys ...string) string {
	rows, ok := data.([]map[string]interface{})
	if !ok || len(rows) == 0 {
		typedRows, typedOK := data.([]map[string]string)
		if !typedOK || len(typedRows) == 0 {
			return ""
		}
		for _, key := range keys {
			if value := strings.TrimSpace(typedRows[0][key]); value != "" {
				return value
			}
		}
		return ""
	}
	for _, key := range keys {
		if value, exists := rows[0][key]; exists {
			if text := strings.TrimSpace(fmt.Sprint(value)); text != "" {
				return text
			}
		}
	}
	return ""
}
