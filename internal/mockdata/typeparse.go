package mockdata

import (
	"strconv"
	"strings"
)

// columnType 是从元数据类型串拆出的各部分。
// 驱动返回的类型串没有统一结构：MySQL `int(11) unsigned`、PG `timestamp(6) with time zone`、
// Oracle `VARCHAR2(100 BYTE)`、SQL Server `nvarchar(max)`、ClickHouse `Nullable(Decimal(10, 2))` 都要能拆。
type columnType struct {
	// Base 是小写、单空格的类型名，不含参数与 unsigned 之类修饰，如 "varchar"、"timestamp with time zone"。
	Base string
	// Args 是第一对括号里的参数，保留原始大小写与引号（枚举标签区分大小写）。
	Args     []string
	Unsigned bool
	Array    bool
	// CharUnit 是 Oracle 风格长度单位 "byte" / "char"，未写为空。
	CharUnit string
}

var clickHouseWrappers = []string{"nullable(", "lowcardinality(", "simpleaggregatefunction("}

func parseColumnType(raw string) columnType {
	text := strings.TrimSpace(raw)
	var parsed columnType
	text = unwrapClickHouseTypes(text)
	if inner, ok := trimFunctionWrapper(text, "array("); ok {
		parsed.Array = true
		text = unwrapClickHouseTypes(inner)
	}
	for strings.HasSuffix(text, "[]") {
		parsed.Array = true
		text = strings.TrimSpace(strings.TrimSuffix(text, "[]"))
	}

	head, inside, tail := splitTypeArgs(text)
	if inside != "" || strings.Contains(text, "(") {
		parsed.Args = splitTopLevel(inside)
	}
	words := strings.Fields(strings.ToLower(head + " " + tail))
	nameWords := make([]string, 0, len(words))
	for _, word := range words {
		switch word {
		case "unsigned":
			parsed.Unsigned = true
		case "signed", "zerofill":
		default:
			nameWords = append(nameWords, word)
		}
	}
	parsed.Base = strings.Join(nameWords, " ")
	if len(parsed.Args) > 0 {
		fields := strings.Fields(strings.ToLower(parsed.Args[0]))
		if len(fields) == 2 && (fields[1] == "byte" || fields[1] == "char") {
			parsed.CharUnit = fields[1]
			parsed.Args[0] = fields[0]
		}
	}
	return parsed
}

// unwrapClickHouseTypes 剥掉 Nullable(...) / LowCardinality(...) 这类不影响取值的包装。
func unwrapClickHouseTypes(text string) string {
	for {
		unwrapped := false
		for _, prefix := range clickHouseWrappers {
			if inner, ok := trimFunctionWrapper(text, prefix); ok {
				if prefix == "simpleaggregatefunction(" {
					// SimpleAggregateFunction(any, UInt64)：真正的类型在最后一个参数。
					parts := splitTopLevel(inner)
					inner = parts[len(parts)-1]
				}
				text = strings.TrimSpace(inner)
				unwrapped = true
			}
		}
		if !unwrapped {
			return text
		}
	}
}

func trimFunctionWrapper(text, lowerPrefix string) (string, bool) {
	if len(text) <= len(lowerPrefix) || !strings.HasSuffix(text, ")") {
		return "", false
	}
	if !strings.EqualFold(text[:len(lowerPrefix)], lowerPrefix) {
		return "", false
	}
	return text[len(lowerPrefix) : len(text)-1], true
}

// splitTypeArgs 把 `name(args) tail` 拆成三段；括号按层级与单引号匹配，枚举标签里的括号不会提前截断。
func splitTypeArgs(text string) (head, inside, tail string) {
	open := strings.IndexByte(text, '(')
	if open < 0 {
		return text, "", ""
	}
	depth := 0
	inQuote := false
	for i := open; i < len(text); i++ {
		ch := text[i]
		switch {
		case ch == '\'':
			inQuote = !inQuote
		case inQuote:
		case ch == '(':
			depth++
		case ch == ')':
			depth--
			if depth == 0 {
				return text[:open], text[open+1 : i], text[i+1:]
			}
		}
	}
	return text[:open], text[open+1:], ""
}

// splitTopLevel 按顶层逗号切分参数，忽略引号和嵌套括号里的逗号。
func splitTopLevel(text string) []string {
	var parts []string
	depth := 0
	inQuote := false
	start := 0
	for i := 0; i < len(text); i++ {
		ch := text[i]
		switch {
		case ch == '\'':
			inQuote = !inQuote
		case inQuote:
		case ch == '(':
			depth++
		case ch == ')':
			depth--
		case ch == ',' && depth == 0:
			parts = append(parts, strings.TrimSpace(text[start:i]))
			start = i + 1
		}
	}
	return append(parts, strings.TrimSpace(text[start:]))
}

// intArg 返回第 index 个参数的整数值；`*`、`max` 或缺省返回 false。
func (t columnType) intArg(index int) (int, bool) {
	if index >= len(t.Args) {
		return 0, false
	}
	value, err := strconv.Atoi(strings.TrimSpace(t.Args[index]))
	if err != nil {
		return 0, false
	}
	return value, true
}

func (t columnType) hasMaxArg() bool {
	return len(t.Args) > 0 && strings.EqualFold(strings.TrimSpace(t.Args[0]), "max")
}

// enumLabels 解析 MySQL `'a','b'` 与 ClickHouse `'a' = 1, 'b' = 2` 两种枚举参数。
func (t columnType) enumLabels() []string {
	labels := make([]string, 0, len(t.Args))
	for _, arg := range t.Args {
		label, ok := unquoteSQLString(arg)
		if !ok {
			continue
		}
		labels = append(labels, label)
	}
	return labels
}

// unquoteSQLString 取出参数开头的单引号字符串，`”` 还原为 `'`。
func unquoteSQLString(arg string) (string, bool) {
	text := strings.TrimSpace(arg)
	if !strings.HasPrefix(text, "'") {
		return "", false
	}
	var builder strings.Builder
	for i := 1; i < len(text); i++ {
		ch := text[i]
		if ch != '\'' {
			builder.WriteByte(ch)
			continue
		}
		if i+1 < len(text) && text[i+1] == '\'' {
			builder.WriteByte('\'')
			i++
			continue
		}
		return builder.String(), true
	}
	return "", false
}
