package app

import (
	"strconv"
	"strings"
)

// SQL Server 的 GO 不是 T-SQL 语法，而是 SSMS/sqlcmd 的客户端批处理分隔符：
// 服务端收到 GO 只会报「"GO" 附近有语法错误」。所有下发路径都必须在下发前识别并丢弃它，
// 同时保留 GO n「整批重复 n 次」的语义。
//
// 识别规则与 SSMS 一致：GO 必须独占一行（行内其前只能是水平空白），
// 行尾允许可选注释与可选重复次数；只在 sqlserver 方言下识别，
// 其它方言里的 go 仍按普通标识符处理。
func isSQLServerBatchSeparatorDialect(dbType string) bool {
	return normalizeSQLClassifierDBType(dbType) == "sqlserver"
}

// scanSQLServerGoDirective 尝试在 text[start] 处解析一条 GO 指令。
// eof 为 true 时把文本结尾视为行尾（整段文本与非流式收尾都这样用）。
// 返回该指令的重复次数 repeat、所在行之后的位置 lineEnd、是否匹配 matched；
// 流式输入被截断而无法判定时返回 incomplete。
func scanSQLServerGoDirective(text string, start int, eof bool) (repeat int, lineEnd int, matched bool, incomplete bool) {
	const keyword = "go"
	if start < 0 || start >= len(text) {
		return 0, start, false, false
	}
	remaining := text[start:]
	prefixLength := len(remaining)
	if prefixLength > len(keyword) {
		prefixLength = len(keyword)
	}
	if !strings.EqualFold(remaining[:prefixLength], keyword[:prefixLength]) {
		return 0, start, false, false
	}
	if len(remaining) < len(keyword) {
		return 0, start, false, !eof
	}
	if len(remaining) > len(keyword) && !isSQLHorizontalWhitespace(remaining[len(keyword)]) && remaining[len(keyword)] != '\n' {
		return 0, start, false, false
	}

	newline := strings.IndexByte(remaining, '\n')
	if newline < 0 && !eof {
		return 0, start, false, true
	}
	line := remaining
	lineEnd = len(text)
	if newline >= 0 {
		line = remaining[:newline]
		lineEnd = start + newline + 1
	}
	remainder := strings.TrimSpace(line[len(keyword):])
	if comment := strings.Index(remainder, "--"); comment >= 0 {
		remainder = strings.TrimSpace(remainder[:comment])
	}
	if remainder == "" {
		return 1, lineEnd, true, false
	}
	parsed, err := strconv.Atoi(remainder)
	if err != nil || parsed <= 0 {
		return 0, start, false, false
	}
	return parsed, lineEnd, true, false
}

// matchSQLServerGoLine 报告 text[start] 是否是独占一行的 GO 批处理分隔符。
// 调用方按首字符预筛后调用，只有行首（行内其前仅水平空白）的 GO 才匹配。
func matchSQLServerGoLine(text string, start int) (repeat int, lineEnd int, matched bool) {
	if start < 0 || start >= len(text) || (text[start] != 'g' && text[start] != 'G') {
		return 0, start, false
	}
	if !sqlLineStartOnlyWhitespaceBefore(text, start) {
		return 0, start, false
	}
	repeat, lineEnd, matched, _ = scanSQLServerGoDirective(text, start, true)
	return repeat, lineEnd, matched
}

// sqlLineStartOnlyWhitespaceBefore 报告 text[pos] 是否位于行首：
// 同一行内其前只有水平空白。GO 只有在行首才是批处理分隔符，
// `SELECT 1; GO` 这类写法必须继续当作普通 token 交给服务端报错。
// 只回溯紧邻的水平空白串，调用方按首字符过滤候选，避免逐字符全行回溯。
func sqlLineStartOnlyWhitespaceBefore(text string, pos int) bool {
	if pos < 0 || pos > len(text) {
		return false
	}
	for i := pos - 1; i >= 0; i-- {
		if !isSQLHorizontalWhitespace(text[i]) {
			return text[i] == '\n'
		}
	}
	return true
}

// sqlCurrentLineWhitespaceOnly 报告缓冲文本最后一个换行之后是否只有水平空白，
// 即下一个 token 是否位于行首（流式拆分器用它判定 GO 的合法位置）。
func sqlCurrentLineWhitespaceOnly(builder interface{ String() string }) bool {
	text := builder.String()
	for i := len(text) - 1; i >= 0; i-- {
		if text[i] == '\n' {
			return true
		}
		if !isSQLHorizontalWhitespace(text[i]) {
			return false
		}
	}
	return true
}

// repeatSQLServerBatchStatements 实现 GO n：把当前批次（batchStart 起已完成的语句）
// 再重复 repeat-1 次，与流式导入路径的 finishSQLServerBatch 语义一致。
func repeatSQLServerBatchStatements(statements *[]string, batchStart, repeat int) {
	if statements == nil || repeat < 2 || batchStart < 0 || batchStart >= len(*statements) {
		return
	}
	batch := append([]string(nil), (*statements)[batchStart:]...)
	for iteration := 1; iteration < repeat; iteration++ {
		*statements = append(*statements, batch...)
	}
}

// sqlServerTextHasBatchSeparator 报告文本中是否存在独占一行的 GO 指令。
func sqlServerTextHasBatchSeparator(text string) bool {
	for lineStart := 0; lineStart <= len(text); {
		lineEnd := strings.IndexByte(text[lineStart:], '\n')
		line := text[lineStart:]
		next := len(text)
		if lineEnd >= 0 {
			line = text[lineStart : lineStart+lineEnd]
			next = lineStart + lineEnd + 1
		}
		trimmed := strings.TrimLeft(line, " \t\r\f")
		if trimmed != "" && (trimmed[0] == 'g' || trimmed[0] == 'G') {
			if _, _, matched, _ := scanSQLServerGoDirective(text, lineStart+len(line)-len(trimmed), true); matched {
				return true
			}
		}
		if next >= len(text) {
			break
		}
		lineStart = next
	}
	return false
}

// sqlServerBatchTextNeedsPerStatement 报告 SQL Server 文本是否含 GO 批处理分隔符。
// 含 GO 时原文不能直接下发：原生多结果集与批量写这两条路径传的是用户原文，
// 会把 GO 送到服务端报「"GO" 附近有语法错误」，因此必须退回逐条执行
// （GO 已由拆分器丢弃，逐条下发的是真正的语句文本）。
func sqlServerBatchTextNeedsPerStatement(dbType, query string) bool {
	return isSQLServerBatchSeparatorDialect(dbType) && sqlServerTextHasBatchSeparator(query)
}
