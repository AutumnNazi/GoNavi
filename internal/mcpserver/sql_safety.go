package mcpserver

import (
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
	appcore "GoNavi-Wails/internal/app"
)

type sqlSafetyStatement struct {
	Index         int
	Keyword       string
	OperationType ai.SQLOperationType
}

type sqlSafetyDecision struct {
	requiresConfirm bool
	disallowed      []sqlSafetyStatement
	confirmRequired []sqlSafetyStatement
}

func isConsistentSQLInspection(inspection appcore.SQLInspection) bool {
	if inspection.StatementCount <= 0 || inspection.StatementCount != len(inspection.Statements) {
		return false
	}
	readOnly := true
	for index, statement := range inspection.Statements {
		if statement.Index != index+1 {
			return false
		}
		if !statement.ReadOnly {
			readOnly = false
		}
	}
	return inspection.ReadOnly == readOnly
}

func evaluateSQLSafety(level ai.SQLPermissionLevel, inspection appcore.SQLInspection) sqlSafetyDecision {
	decision := sqlSafetyDecision{
		disallowed:      []sqlSafetyStatement{},
		confirmRequired: []sqlSafetyStatement{},
	}

	for _, stmt := range inspection.Statements {
		statement := sqlSafetyStatement{
			Index:         stmt.Index,
			Keyword:       strings.TrimSpace(stmt.Keyword),
			OperationType: classifyStatementOperation(stmt),
		}
		if !isOperationAllowed(level, statement.OperationType) {
			decision.disallowed = append(decision.disallowed, statement)
			continue
		}
		if statement.OperationType != ai.SQLOpQuery {
			decision.requiresConfirm = true
			decision.confirmRequired = append(decision.confirmRequired, statement)
		}
	}

	return decision
}

// applyExecuteSQLSafety is the shared gate for in-app assistant and remote MCP.
// Safety level decides which SQL is allowed. The execute_sql tool call itself is
// the confirmation, matching Harness approval in the built-in assistant.
func applyExecuteSQLSafety(level ai.SQLPermissionLevel, inspection appcore.SQLInspection) (mutatingAck bool, denyMessage string) {
	decision := evaluateSQLSafety(level, inspection)
	if len(decision.disallowed) > 0 {
		return false, buildSafetyDeniedMessage(level, decision.disallowed)
	}
	return decision.requiresConfirm, ""
}

func classifyStatementOperation(stmt appcore.SQLStatementInspection) ai.SQLOperationType {
	if stmt.ReadOnly {
		return ai.SQLOpQuery
	}

	switch strings.ToLower(strings.TrimSpace(stmt.Keyword)) {
	case "insert", "update", "delete", "replace", "merge", "upsert":
		return ai.SQLOpDML
	case "create", "alter", "drop", "truncate", "rename":
		return ai.SQLOpDDL
	default:
		return ai.SQLOpOther
	}
}

func isOperationAllowed(level ai.SQLPermissionLevel, opType ai.SQLOperationType) bool {
	switch normalizeSQLSafetyLevel(level) {
	case ai.PermissionReadOnly:
		return opType == ai.SQLOpQuery
	case ai.PermissionReadWrite:
		return opType == ai.SQLOpQuery || opType == ai.SQLOpDML
	case ai.PermissionFull:
		return true
	default:
		return opType == ai.SQLOpQuery
	}
}

func normalizeSQLSafetyLevel(level ai.SQLPermissionLevel) ai.SQLPermissionLevel {
	switch level {
	case ai.PermissionReadOnly, ai.PermissionReadWrite, ai.PermissionFull:
		return level
	default:
		return ai.PermissionReadOnly
	}
}

func buildSafetyDeniedMessage(level ai.SQLPermissionLevel, statements []sqlSafetyStatement) string {
	return fmt.Sprintf("当前 GoNavi AI 安全控制为%s，已阻止以下语句：%s。%s", safetyLevelDisplayName(level), formatSafetyStatements(statements), safetyLevelRuleText(level))
}

func safetyLevelDisplayName(level ai.SQLPermissionLevel) string {
	switch normalizeSQLSafetyLevel(level) {
	case ai.PermissionReadOnly:
		return "只读模式"
	case ai.PermissionReadWrite:
		return "读写模式"
	case ai.PermissionFull:
		return "完全模式"
	default:
		return "只读模式"
	}
}

func safetyLevelRuleText(level ai.SQLPermissionLevel) string {
	switch normalizeSQLSafetyLevel(level) {
	case ai.PermissionReadOnly:
		return "只读模式仅允许查询语句。"
	case ai.PermissionReadWrite:
		return "读写模式仅允许查询和 DML 语句。"
	case ai.PermissionFull:
		return "完全模式允许所有 SQL 操作；高风险或未识别语句仍会要求确认。"
	default:
		return "只读模式仅允许查询语句。"
	}
}

func formatSafetyStatements(statements []sqlSafetyStatement) string {
	parts := make([]string, 0, len(statements))
	for _, stmt := range statements {
		keyword := strings.TrimSpace(stmt.Keyword)
		if keyword == "" {
			keyword = "unknown"
		}
		parts = append(parts, fmt.Sprintf("#%d %s(%s)", stmt.Index, strings.ToLower(keyword), strings.ToUpper(string(stmt.OperationType))))
	}
	return strings.Join(parts, "，")
}
