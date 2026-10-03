package app

import "GoNavi-Wails/internal/connection"

// registryExplainDialect 是描述表数据源的执行计划方言：均使用不执行原查询的普通 EXPLAIN，
// 计划格式与兼容协议的母方言不同，由各自的解析器处理。
type registryExplainDialect struct {
	format connection.ExplainFormat
	parse  func(dbType, sourceSQL, raw string, text explainText) connection.ExplainResult
}

var registryExplainDialects = map[string]registryExplainDialect{
	// TiDB 不支持 MySQL 的 FORMAT=JSON，输出 id/estRows/task/access object/operator info 表格。
	"tidb": {format: connection.ExplainFormatTable, parse: func(_, sourceSQL, raw string, text explainText) connection.ExplainResult {
		return parseTiDBExplain(sourceSQL, raw, text)
	}},
	// CockroachDB 家族不支持 EXPLAIN (FORMAT JSON)：新版本是 info 文本树，KWDB 是 tree/field/description 表格。
	"cockroachdb": {format: connection.ExplainFormatText, parse: parseCockroachExplain},
	"kwdb":        {format: connection.ExplainFormatText, parse: parseCockroachExplain},
	// QuestDB 的 EXPLAIN 是单列 QUERY PLAN 缩进文本。
	"questdb": {format: connection.ExplainFormatText, parse: parseQuestDBExplain},
}

// isRegistryExplainDialect 报告诊断入口是否支持该描述表类型的执行计划。
func isRegistryExplainDialect(dbType string) bool {
	_, ok := registryExplainDialects[dbType]
	return ok
}
