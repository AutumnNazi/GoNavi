package app

import (
	"strings"
	"unicode"

	"GoNavi-Wails/internal/connection"
)

// parseCockroachExplain 解析 CockroachDB 家族的 EXPLAIN：
//   - CockroachDB 21.1+：单列 info 文本树，"• scan" 是节点，"key: value" 是节点属性，
//     末尾可能带 "index recommendations"；
//   - KWDB 与 CockroachDB 20.x：tree | field | description 表格，tree 列有节点名时开新节点。
func parseCockroachExplain(dbType, sourceSQL, raw string) connection.ExplainResult {
	result := connection.ExplainResult{
		DBType:     dbType,
		SourceSQL:  sourceSQL,
		RawFormat:  connection.ExplainFormatText,
		RawPayload: raw,
	}
	header, rows := parseExplainTSVRows(raw)
	switch {
	case lookupTSVColumn(header, "tree") >= 0 && lookupTSVColumn(header, "field") >= 0:
		parseCockroachTableExplain(&result, header, rows)
	case lookupTSVColumn(header, "info") >= 0:
		parseCockroachTextExplain(&result, rows)
	}
	if len(result.Nodes) == 0 {
		result.Warnings = append(result.Warnings, "未识别到 CockroachDB 计划算子，请查看原文")
		return result
	}
	finalizeExplainStats(&result)
	return result
}

// cockroachPlanBuilder 按缩进层级维护当前路径上的父节点。
type cockroachPlanBuilder struct {
	result  *connection.ExplainResult
	parents []string
	current int
}

func (b *cockroachPlanBuilder) addNode(depth int, operator string) {
	if depth > len(b.parents) {
		depth = len(b.parents)
	}
	parentID := ""
	if depth > 0 {
		parentID = b.parents[depth-1]
	}
	node := connection.ExplainNode{
		OpType:   classifyCockroachOperator(operator),
		OpDetail: operator,
		Extra:    map[string]any{"operator": operator},
	}
	nodeID := appendExplainChild(b.result, parentID, node)
	b.parents = append(b.parents[:depth], nodeID)
	b.current = len(b.result.Nodes) - 1
}

func (b *cockroachPlanBuilder) addProperty(key, value string) {
	if b.current < 0 {
		return
	}
	applyCockroachPlanProperty(&b.result.Nodes[b.current], key, value)
}

func parseCockroachTextExplain(result *connection.ExplainResult, rows [][]string) {
	builder := cockroachPlanBuilder{result: result, current: -1}
	inRecommendations := false
	for _, row := range rows {
		if len(row) == 0 {
			continue
		}
		line := strings.TrimRight(row[0], " ")
		trimmed := strings.TrimSpace(strings.TrimLeft(line, " │├└─"))
		if strings.HasPrefix(strings.ToLower(trimmed), "index recommendations") {
			inRecommendations = true
			continue
		}
		if inRecommendations {
			if command, ok := strings.CutPrefix(trimmed, "SQL commands:"); ok {
				result.Warnings = append(result.Warnings, "索引建议："+strings.TrimSpace(command))
			}
			continue
		}
		if bullet := strings.IndexRune(line, '•'); bullet >= 0 {
			depth := len([]rune(line[:bullet])) / 4
			builder.addNode(depth, strings.TrimSpace(line[bullet+len("•"):]))
			continue
		}
		if key, value, ok := strings.Cut(trimmed, ":"); ok && builder.current >= 0 {
			builder.addProperty(strings.TrimSpace(key), strings.TrimSpace(value))
		}
	}
}

func parseCockroachTableExplain(result *connection.ExplainResult, header []string, rows [][]string) {
	treeCol := lookupTSVColumn(header, "tree")
	fieldCol := lookupTSVColumn(header, "field")
	descCol := lookupTSVColumn(header, "description")
	builder := cockroachPlanBuilder{result: result, current: -1}
	for _, row := range rows {
		tree := ""
		if treeCol < len(row) {
			tree = row[treeCol]
		}
		runes := []rune(tree)
		start := 0
		for start < len(runes) && !unicode.IsLetter(runes[start]) {
			start++
		}
		if start < len(runes) {
			builder.addNode(start/5, strings.TrimSpace(string(runes[start:])))
			continue
		}
		field := strings.TrimSpace(tidbExplainCell(row, fieldCol))
		if field != "" {
			builder.addProperty(field, strings.TrimSpace(tidbExplainCell(row, descCol)))
		}
	}
}

func classifyCockroachOperator(operator string) string {
	lower := strings.ToLower(operator)
	switch {
	case strings.Contains(lower, "index join"), strings.Contains(lower, "index-join"):
		return connection.ExplainOpIndexScan
	case strings.Contains(lower, "join"), strings.Contains(lower, "apply"):
		return connection.ExplainOpJoin
	case strings.HasPrefix(lower, "scan"), strings.Contains(lower, "virtual table"):
		return connection.ExplainOpScan
	case strings.HasPrefix(lower, "group"), strings.Contains(lower, "aggregate"), strings.Contains(lower, "distinct"):
		return connection.ExplainOpAggregate
	case strings.HasPrefix(lower, "sort"), strings.HasPrefix(lower, "top-k"):
		return connection.ExplainOpSort
	case strings.HasPrefix(lower, "limit"):
		return connection.ExplainOpLimit
	case strings.HasPrefix(lower, "filter"):
		return connection.ExplainOpFilter
	case strings.Contains(lower, "union"):
		return connection.ExplainOpUnion
	case strings.HasPrefix(lower, "window"):
		return connection.ExplainOpWindow
	case strings.HasPrefix(lower, "insert"), strings.HasPrefix(lower, "upsert"):
		return connection.ExplainOpInsert
	case strings.HasPrefix(lower, "update"):
		return connection.ExplainOpUpdate
	case strings.HasPrefix(lower, "delete"):
		return connection.ExplainOpDelete
	default:
		return connection.ExplainOpOther
	}
}

// applyCockroachPlanProperty 把 "table: a@a_pkey"、"spans: FULL SCAN"、"estimated row count: 10" 等属性落到节点上。
func applyCockroachPlanProperty(node *connection.ExplainNode, key, value string) {
	lowerKey := strings.ToLower(key)
	switch lowerKey {
	case "table":
		table, index, _ := strings.Cut(value, "@")
		node.Table, node.Index = strings.TrimSpace(table), strings.TrimSpace(index)
	case "spans":
		if strings.EqualFold(value, "FULL SCAN") || strings.HasPrefix(strings.ToUpper(value), "FULL SCAN") {
			node.Flags = appendUniqueExplainFlags(node.Flags, connection.ExplainFlagFullScan)
		}
	case "estimated row count":
		node.EstRows = parseExplainInt64(strings.ReplaceAll(value, ",", ""))
	case "actual row count":
		node.ActualRows = parseExplainInt64(strings.ReplaceAll(value, ",", ""))
	case "filter", "equality", "order", "group by", "type":
		node.OpDetail = strings.TrimSpace(node.OpDetail + " " + key + ": " + value)
	}
	if node.Extra == nil {
		node.Extra = map[string]any{}
	}
	node.Extra[lowerKey] = value
}
