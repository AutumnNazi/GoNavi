// Package sqlparam 提供查询编辑器运行时绑定参数的扫描、重写与值转换。
//
// 参数语法为命名参数 :name（[A-Za-z_][A-Za-z0-9_$#]*）。扫描遵循 SQL 词法边界：
// 字符串字面量、引号标识符、注释与 dollar-quote 块内的冒号不构成参数，PG 类型
// 转换 :: 不构成参数。词法选项与 internal/app/sql_split.go 的语句拆分器保持
// 一致，确保「按语句分组」与「参数扫描」对同一份 SQL 得到互相吻合的边界。
package sqlparam

import "strings"

// ScanOptions 控制方言相关的词法规则，字段语义与 sql_split.go 的方言判定对齐。
type ScanOptions struct {
	// BackslashEscapes 表示引号内反斜杠是转义符。查询执行链路沿用
	// SplitSQLStatementsForDialect 的默认（true），保证两个扫描器的字符串
	// 边界判定一致。
	BackslashEscapes bool
	// HashComments 表示 # 是行注释（MySQL 系与 ClickHouse）。
	HashComments bool
	// DashCommentNeedsSpace 表示 -- 仅在后跟空白或行尾时才开始注释（MySQL 系）。
	DashCommentNeedsSpace bool
	// BracketIdentifiers 表示 [name] 是定界标识符（SQL Server/SQLite）。
	BracketIdentifiers bool
	// EscapedBracketIdentifiers 表示 ]] 是标识符内的字面量 ]（SQL Server）。
	EscapedBracketIdentifiers bool
	// DollarQuotes 表示支持 $$...$$ 与 $tag$...$tag$ 块（PostgreSQL 系）。
	DollarQuotes bool
}

// OptionsForDBType 按数据源类型返回与语句拆分器一致的词法选项。
// 归一化别名表镜像 normalizeExplainLexicalDBType；空类型沿用拆分器对未知
// 方言的宽松默认。
func OptionsForDBType(dbType string) ScanOptions {
	normalized := normalizeDBType(dbType)
	opts := ScanOptions{BackslashEscapes: true}
	if normalized == "" {
		opts.HashComments = true
		opts.DollarQuotes = true
		return opts
	}
	switch normalized {
	case "mysql", "mariadb", "oceanbase", "diros", "starrocks", "goldendb", "sphinx", "tidb":
		opts.HashComments = true
		opts.DashCommentNeedsSpace = true
	case "clickhouse":
		opts.HashComments = true
	case "sqlserver":
		opts.BracketIdentifiers = true
		opts.EscapedBracketIdentifiers = true
	case "sqlite":
		opts.BracketIdentifiers = true
	case "postgres", "opengauss", "gaussdb", "kingbase", "highgo", "vastbase":
		opts.DollarQuotes = true
	}
	return opts
}

func normalizeDBType(dbType string) string {
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	switch normalized {
	case "postgresql", "pg", "pq", "pgx":
		return "postgres"
	case "doris":
		return "diros"
	case "open_gauss", "open-gauss":
		return "opengauss"
	case "gauss_db", "gauss-db":
		return "gaussdb"
	case "kingbase8", "kingbasees", "kingbasev8":
		return "kingbase"
	case "greatdb", "gdb":
		return "goldendb"
	default:
		return normalized
	}
}

// Span 描述一个命名参数在原文中的字节跨度（含起始冒号，不含结束）。
type Span struct {
	Name  string
	Start int
	End   int
}

// Scan 返回 sql 中所有命名参数 :name 的出现位置，按出现顺序排列，不去重。
func Scan(sql string, opts ScanOptions) []Span {
	var spans []Span
	inSingle, inDouble, inBacktick, inBracket := false, false, false, false
	inLineComment, inBlockComment, escaped := false, false, false
	dollarTag := ""

	for i := 0; i < len(sql); i++ {
		ch := sql[i]
		next := byte(0)
		if i+1 < len(sql) {
			next = sql[i+1]
		}

		if inLineComment {
			if ch == '\n' {
				inLineComment = false
			}
			continue
		}
		if inBlockComment {
			if ch == '*' && next == '/' {
				i++
				inBlockComment = false
			}
			continue
		}
		if inBracket {
			if ch == ']' {
				if opts.EscapedBracketIdentifiers && next == ']' {
					i++
					continue
				}
				inBracket = false
			}
			continue
		}
		if dollarTag != "" {
			if strings.HasPrefix(sql[i:], dollarTag) {
				i += len(dollarTag) - 1
				dollarTag = ""
			}
			continue
		}
		if escaped {
			escaped = false
			continue
		}
		if opts.BackslashEscapes && (inSingle || inDouble) && ch == '\\' {
			escaped = true
			continue
		}

		if !inDouble && !inBacktick && ch == '\'' {
			if inSingle && next == '\'' {
				i++
				continue
			}
			inSingle = !inSingle
			continue
		}
		if !inSingle && !inBacktick && ch == '"' {
			inDouble = !inDouble
			continue
		}
		if !inSingle && !inDouble && ch == '`' {
			inBacktick = !inBacktick
			continue
		}
		if opts.BracketIdentifiers && !inSingle && !inDouble && !inBacktick && ch == '[' {
			inBracket = true
			continue
		}
		if inSingle || inDouble || inBacktick {
			continue
		}

		if ch == '-' && next == '-' && dashCommentStartsAt(sql, i, opts.DashCommentNeedsSpace) {
			inLineComment = true
			continue
		}
		if opts.HashComments && ch == '#' {
			inLineComment = true
			continue
		}
		if ch == '/' && next == '*' {
			inBlockComment = true
			i++
			continue
		}
		if opts.DollarQuotes && ch == '$' {
			if tag := parseDollarTagAt(sql, i); tag != "" {
				dollarTag = tag
				i += len(tag) - 1
				continue
			}
		}

		if ch == ':' && next != ':' {
			prev := byte(' ')
			if i > 0 {
				prev = sql[i-1]
			}
			if prev != ':' && !isIdentifierPart(prev) && isIdentifierStart(next) {
				end := i + 2
				for end < len(sql) && isIdentifierPart(sql[end]) {
					end++
				}
				spans = append(spans, Span{Name: sql[i+1 : end], Start: i, End: end})
				i = end - 1
				continue
			}
		}
	}
	return spans
}

// Names 返回 sql 中去重后的参数名，保持首次出现顺序。
func Names(sql string, opts ScanOptions) []string {
	seen := make(map[string]struct{})
	var names []string
	for _, span := range Scan(sql, opts) {
		if _, ok := seen[span.Name]; ok {
			continue
		}
		seen[span.Name] = struct{}{}
		names = append(names, span.Name)
	}
	return names
}

func dashCommentStartsAt(text string, index int, needsSpace bool) bool {
	if !needsSpace {
		return true
	}
	third := index + 2
	return third >= len(text) || text[third] <= ' '
}

func parseDollarTagAt(text string, start int) string {
	if start < 0 || start >= len(text) || text[start] != '$' {
		return ""
	}
	if start > 0 && isIdentifierPart(text[start-1]) {
		return ""
	}
	if start+1 >= len(text) {
		return ""
	}
	if text[start+1] == '$' {
		return "$$"
	}
	if !isIdentifierStart(text[start+1]) {
		return ""
	}
	for end := start + 2; end < len(text); end++ {
		if text[end] == '$' {
			return text[start : end+1]
		}
		if !isIdentifierPart(text[end]) || text[end] == '$' || text[end] == '#' {
			return ""
		}
	}
	return ""
}

func isIdentifierStart(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_'
}

func isIdentifierPart(ch byte) bool {
	return isIdentifierStart(ch) || (ch >= '0' && ch <= '9') || ch == '$' || ch == '#'
}
