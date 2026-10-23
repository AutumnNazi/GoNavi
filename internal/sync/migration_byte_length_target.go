package sync

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// openGauss 系的字符长度单位取决于版本、兼容模式及列声明，不能仅凭品牌断言。
// Oracle 字符语义在目标能力探测成功时显式保留；旧版或编码语义未知时继续
// 使用至多四倍的 UTF-8 容量兜底，并告警说明约束、CHAR 补空格可能发生变化。

const (
	// byteLengthWidenFactor 为 UTF-8 单个字符的最大字节数。
	byteLengthWidenFactor = 4
	// byteLengthTypeMaxLength 是 openGauss 系变长字符类型的长度上限（字节）。
	byteLengthTypeMaxLength = 10485760
	// byteLengthWarningColumnLimit 限制告警里列出的字段数，避免宽表刷屏。
	byteLengthWarningColumnLimit = 5
)

// charLengthTypePattern 匹配带长度的定长/变长字符类型（中间表示与 PG 系写法都覆盖）。
var charLengthTypePattern = regexp.MustCompile(`(?i)^(\s*(?:character\s+varying|varchar|character|char|bpchar)\s*\(\s*)(\d+)(\s*\)\s*)$`)

// targetCountsCharLengthInBytes 标记可能按字节计长的目标族，不代表已确认当前列语义。
func targetCountsCharLengthInBytes(dbType string) bool {
	switch normalizeMigrationDBType(dbType) {
	case "vastbase", "opengauss", "gaussdb":
		return true
	default:
		return false
	}
}

// byteLengthWidener 在建表 / 补列阶段放宽字符列长度，并汇总告警。
// 零值与 nil 都是「不生效」，调用方无需判空。
type byteLengthWidener struct {
	targetType string
	active     bool
	qualified  bool
	widened    []string
}

// newByteLengthWidener 对跨族迁移使用保守预算，同族沿用原路径，不声称语义等价。
func newByteLengthWidener(sourceType, targetType string, target ...*characterLengthTarget) *byteLengthWidener {
	qualified := len(target) > 0 && target[0] != nil && target[0].qualified
	return &byteLengthWidener{
		qualified:  qualified,
		targetType: strings.TrimSpace(targetType),
		active:     targetCountsCharLengthInBytes(targetType) && !targetCountsCharLengthInBytes(sourceType),
	}
}

// widenCharLengthType 把 varchar(n)/char(n) 的 n 放宽到 4 倍，返回新类型与放宽前后的长度。
func widenCharLengthType(rawType string) (string, int, int, bool) {
	match := charLengthTypePattern.FindStringSubmatch(rawType)
	if match == nil {
		return rawType, 0, 0, false
	}
	length, err := strconv.Atoi(match[2])
	if err != nil || length <= 0 || length >= byteLengthTypeMaxLength {
		return rawType, 0, 0, false
	}
	widened := min(length*byteLengthWidenFactor, byteLengthTypeMaxLength)
	return match[1] + strconv.Itoa(widened) + match[3], length, widened, true
}

// Adapt 返回放宽长度后的列定义；不需要放宽时原样返回。
func (w *byteLengthWidener) Adapt(col connection.ColumnDefinition) connection.ColumnDefinition {
	if w == nil || !w.active {
		return col
	}
	widenedType, from, to, ok := widenCharLengthType(col.Type)
	if !ok {
		return col
	}
	w.widened = append(w.widened, fmt.Sprintf("%s(%d→%d)", col.Name, from, to))
	col.Type = widenedType
	return col
}

// Warnings 汇总为一条告警；没有放宽任何列时返回 nil。
func (w *byteLengthWidener) Warnings() []string {
	if w == nil || len(w.widened) == 0 {
		return nil
	}
	shown := w.widened[:min(len(w.widened), byteLengthWarningColumnLimit)]
	return []string{localizedSyncBackendText("data_sync.backend.hint.character_length_widened", map[string]any{
		"target": w.targetType, "factor": byteLengthWidenFactor,
		"columns": strings.Join(shown, "、"), "count": len(w.widened),
	})}
}

// isValueTooLongError 判定写入错误是否为「值超出列长度」（SQLSTATE 22001）。
func isValueTooLongError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "22001") ||
		strings.Contains(text, "value too long") ||
		strings.Contains(text, "值太长")
}

// byteLengthOverflowHint 给「目标按字节计长 + 值太长」的写入失败补一句可操作的提示。
// 目标表已存在时无法由同步自动改长度，只能提示用户处理。
func byteLengthOverflowHint(targetType string, err error) string {
	if !targetCountsCharLengthInBytes(targetType) || !isValueTooLongError(err) {
		return ""
	}
	return localizedSyncBackendText("data_sync.backend.hint.byte_length_overflow", map[string]any{
		"target": strings.TrimSpace(targetType),
	})
}
