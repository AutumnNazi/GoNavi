package mockdata

import (
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// 文本格式与 CSV 导入一致，驱动按列类型解析。
const (
	layoutDate     = "2006-01-02"
	layoutTime     = "15:04:05"
	layoutDateTime = "2006-01-02 15:04:05"
)

func parseInt(text string) (int64, bool) {
	value, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	return value, err == nil
}

// parseDecimalUnits 把十进制文本换算成 10^-scale 的整数单位，例如 ("12.5", 2) → 1250。
// 超出 int64 或小数位多于 scale 时返回 false。
func parseDecimalUnits(text string, scale int) (int64, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, false
	}
	negative := strings.HasPrefix(text, "-")
	text = strings.TrimPrefix(strings.TrimPrefix(text, "-"), "+")
	intPart, fracPart, _ := strings.Cut(text, ".")
	if intPart == "" {
		intPart = "0"
	}
	if len(fracPart) > scale || !allDigits(intPart) || !allDigits(fracPart) {
		return 0, false
	}
	digits := intPart + fracPart + strings.Repeat("0", scale-len(fracPart))
	digits = strings.TrimLeft(digits, "0")
	if digits == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return 0, false
	}
	if negative {
		value = -value
	}
	return value, true
}

// truncateDecimalUnits 解析类型上下界：上下界的小数位可能多于生成用的 scale，多出的部分直接截掉。
func truncateDecimalUnits(text string, scale int) (int64, bool) {
	intPart, fracPart, _ := strings.Cut(strings.TrimSpace(text), ".")
	if len(fracPart) > scale {
		fracPart = fracPart[:scale]
	}
	if fracPart == "" {
		return parseDecimalUnits(intPart, scale)
	}
	return parseDecimalUnits(intPart+"."+fracPart, scale)
}

func allDigits(text string) bool {
	for i := 0; i < len(text); i++ {
		if text[i] < '0' || text[i] > '9' {
			return false
		}
	}
	return true
}

func formatDecimalUnits(units int64, scale int) string {
	if scale <= 0 {
		return strconv.FormatInt(units, 10)
	}
	negative := units < 0
	magnitude := strconv.FormatUint(absUint64(units), 10)
	if len(magnitude) <= scale {
		magnitude = strings.Repeat("0", scale-len(magnitude)+1) + magnitude
	}
	text := magnitude[:len(magnitude)-scale] + "." + magnitude[len(magnitude)-scale:]
	if negative {
		return "-" + text
	}
	return text
}

func absUint64(value int64) uint64 {
	if value < 0 {
		return uint64(-(value + 1)) + 1
	}
	return uint64(value)
}

// randomInt64 在闭区间 [low, high] 内均匀取值，跨满 int64 也不溢出。
func randomInt64(rng randSource, low, high int64) int64 {
	span := uint64(high) - uint64(low)
	if span == math.MaxUint64 {
		return int64(rng.Uint64())
	}
	return int64(uint64(low) + rng.Uint64N(span+1))
}

func parseTemporal(category Category, text string) (time.Time, bool) {
	layout := layoutDateTime
	switch category {
	case CategoryDate:
		layout = layoutDate
	case CategoryTime:
		layout = layoutTime
	}
	value, err := time.Parse(layout, strings.TrimSpace(text))
	return value, err == nil
}

func formatTemporal(category Category, value time.Time) string {
	switch category {
	case CategoryDate:
		return value.Format(layoutDate)
	case CategoryTime:
		return value.Format(layoutTime)
	}
	return value.Format(layoutDateTime)
}

// fitLength 把值截到列能容纳的长度；按字节计时在字符边界截断，避免写出半个汉字。
func fitLength(value string, maxLength int, inBytes bool) string {
	if maxLength <= 0 {
		return value
	}
	if inBytes {
		if len(value) <= maxLength {
			return value
		}
		cut := maxLength
		for cut > 0 && !utf8.RuneStart(value[cut]) {
			cut--
		}
		return value[:cut]
	}
	if utf8.RuneCountInString(value) <= maxLength {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxLength])
}

func valueLength(value string, inBytes bool) int {
	if inBytes {
		return len(value)
	}
	return utf8.RuneCountInString(value)
}

// randomUUID 用确定性随机源生成 v4 UUID，保证预览与写入一致。
func randomUUID(rng randSource, compact bool) string {
	var raw [16]byte
	for i := 0; i < len(raw); i += 8 {
		word := rng.Uint64()
		for j := 0; j < 8; j++ {
			raw[i+j] = byte(word >> (8 * j))
		}
	}
	raw[6] = raw[6]&0x0f | 0x40
	raw[8] = raw[8]&0x3f | 0x80
	text := uuid.UUID(raw).String()
	if compact {
		return strings.ReplaceAll(text, "-", "")
	}
	return text
}

func pick[T any](rng randSource, items []T) T {
	return items[rng.IntN(len(items))]
}
