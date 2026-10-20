package app

import (
	"strings"

	"GoNavi-Wails/internal/ai"
)

// SQLStatementInspection 描述一条拆分后的 SQL 语句的基础特征。
type SQLStatementInspection struct {
	Index    int    `json:"index"`
	Keyword  string `json:"keyword,omitempty"`
	ReadOnly bool   `json:"readOnly"`
	// OperationType carries non-SQL command semantics without changing the RPC schema.
	OperationType ai.SQLOperationType `json:"-"`
}

// SQLInspection 描述一段 SQL 文本的整体执行特征。
type SQLInspection struct {
	StatementCount int                      `json:"statementCount"`
	ReadOnly       bool                     `json:"readOnly"`
	Statements     []SQLStatementInspection `json:"statements"`
}

// InspectSQL 基于现有 SQL 拆分与只读判定逻辑，为外部调用方提供安全边界判断。
func InspectSQL(dbType string, sql string) SQLInspection {
	statements := inspectionStatements(dbType, sql)
	result := SQLInspection{
		ReadOnly:   true,
		Statements: make([]SQLStatementInspection, 0, len(statements)),
	}

	for _, stmt := range statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			continue
		}
		item := inspectStatement(dbType, trimmed, len(result.Statements)+1)
		if !item.ReadOnly {
			result.ReadOnly = false
		}
		result.Statements = append(result.Statements, item)
	}

	result.StatementCount = len(result.Statements)
	if result.StatementCount == 0 {
		result.ReadOnly = true
	}
	return result
}
