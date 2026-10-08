package mockdata

import (
	"math"
	"strconv"
	"strings"
)

const maxDecimalDigits = 18 // int64 能精确表示的十进制位数

// integerBounds 返回整数列的取值范围；超出 int64 的部分截到 int64。
func integerBounds(family Family, parsed columnType) (int64, int64) {
	base := parsed.Base
	if precision, ok := integerDecimalPrecision(parsed); ok {
		limit := pow10Capped(precision)
		if parsed.Unsigned {
			return 0, limit
		}
		return -limit, limit
	}
	bits := clickHouseIntBits(family, base)
	if bits == 0 {
		bits = integerBits[base]
	}
	if bits == 0 {
		bits = 64
	}
	unsigned := parsed.Unsigned || unsignedIntegerBases[base] ||
		(family == FamilyClickHouse && strings.HasPrefix(base, "u")) ||
		(family == FamilySQLServer && base == "tinyint")
	if bits >= 64 {
		if unsigned {
			return 0, math.MaxInt64
		}
		return math.MinInt64, math.MaxInt64
	}
	if unsigned {
		return 0, int64(1)<<bits - 1
	}
	return -(int64(1) << (bits - 1)), int64(1)<<(bits-1) - 1
}

// integerDecimalPrecision 识别按整数生成的定点数（NUMBER(p)、DECIMAL(p,0)），返回精度。
func integerDecimalPrecision(parsed columnType) (int, bool) {
	if _, ok := categoryByBase[parsed.Base]; !ok || len(parsed.Args) == 0 {
		return 0, false
	}
	if strings.TrimSpace(parsed.Args[0]) == "*" {
		return 38, true
	}
	return parsed.intArg(0)
}

// decimalShape 返回定点数的精度与小数位；精度 0 表示不限（PG numeric、Oracle NUMBER）。
func decimalShape(family Family, parsed columnType) (int, int) {
	switch parsed.Base {
	case "money":
		if family == FamilySQLServer {
			return 19, 4
		}
		return 17, 2
	case "smallmoney":
		return 10, 4
	case "decimal32", "decimal64", "decimal128", "decimal256":
		precision := map[string]int{"decimal32": 9, "decimal64": 18, "decimal128": 38, "decimal256": 76}[parsed.Base]
		scale, _ := parsed.intArg(0)
		return precision, scale
	}
	precision, ok := parsed.intArg(0)
	if !ok {
		return 0, 0
	}
	scale, _ := parsed.intArg(1)
	return precision, scale
}

// decimalBoundText 返回 decimal(p,s) 的最大值文本，如 (5,2) → "999.99"；整数位超过 18 位时截到 18 位。
func decimalBoundText(precision, scale int) string {
	intDigits := max(min(precision-scale, maxDecimalDigits-scale), 0)
	text := strings.Repeat("9", intDigits)
	if text == "" {
		text = "0"
	}
	if scale > 0 {
		text += "." + strings.Repeat("9", scale)
	}
	return text
}

func pow10Capped(exponent int) int64 {
	if exponent >= maxDecimalDigits+1 {
		return math.MaxInt64
	}
	value := int64(1)
	for range exponent {
		value *= 10
	}
	return value - 1
}

// temporalBounds 返回日期/时间类列可写入的范围，格式与生成器一致。
func temporalBounds(family Family, category Category, base string) (string, string) {
	switch category {
	case CategoryTime:
		return "00:00:00", "23:59:59"
	case CategoryYear:
		return "1901", "2155"
	case CategoryDate:
		return dateBounds(family, base)
	case CategoryDateTime:
		return dateTimeBounds(family, base)
	}
	return "", ""
}

func dateBounds(family Family, base string) (string, string) {
	switch {
	case family == FamilyMySQL:
		return "1000-01-01", "9999-12-31"
	case family == FamilyClickHouse && base == "date32":
		return "1900-01-01", "2299-12-31"
	case family == FamilyClickHouse:
		return "1970-01-01", "2149-06-06"
	}
	return "0001-01-01", "9999-12-31"
}

func dateTimeBounds(family Family, base string) (string, string) {
	switch {
	case family == FamilyMySQL && base == "timestamp":
		return "1970-01-01 00:00:01", "2038-01-19 03:14:07"
	case family == FamilyMySQL:
		return "1000-01-01 00:00:00", "9999-12-31 23:59:59"
	case family == FamilySQLServer && base == "smalldatetime":
		return "1900-01-01 00:00:00", "2079-06-06 23:59:00"
	case family == FamilySQLServer && base == "datetime":
		return "1753-01-01 00:00:00", "9999-12-31 23:59:59"
	case family == FamilyClickHouse && base == "datetime64":
		return "1900-01-01 00:00:00", "2299-12-31 23:59:59"
	case family == FamilyClickHouse:
		return "1970-01-01 00:00:00", "2106-02-07 06:28:15"
	case family == FamilyTDengine:
		return "1970-01-01 00:00:00", "9999-12-31 23:59:59"
	}
	return "0001-01-01 00:00:00", "9999-12-31 23:59:59"
}

// stringLimits 返回字符串列的长度上限与计量单位；0 表示不限。
func stringLimits(family Family, parsed columnType, category Category) (int, bool) {
	base := parsed.Base
	if category == CategoryText {
		switch {
		case family == FamilyMySQL && base == "tinytext":
			return 255, true
		case family == FamilyMySQL && base == "text":
			return 65535, true
		}
		return 0, false
	}
	if parsed.hasMaxArg() {
		return 0, false
	}
	length, ok := parsed.intArg(0)
	if !ok {
		if base == "char" || base == "character" || base == "nchar" {
			length = 1
		}
	}
	return length, stringLengthInBytes(family, parsed)
}

func stringLengthInBytes(family Family, parsed columnType) bool {
	switch parsed.CharUnit {
	case "byte":
		return true
	case "char":
		return false
	}
	base := parsed.Base
	national := strings.HasPrefix(base, "n") || strings.HasPrefix(base, "national")
	switch {
	case base == "fixedstring":
		return true
	case family == FamilySQLServer, family == FamilyTDengine:
		return !national
	case family.countsLengthInBytes():
		return !national
	}
	return false
}

// asciiOnly 表示列的字符集存不下中文，生成器应只出 ASCII。
func asciiOnly(family Family, parsed columnType, charset string) bool {
	base := parsed.Base
	switch family {
	case FamilySQLServer:
		return base == "char" || base == "varchar" || base == "text"
	case FamilyTDengine:
		return base == "binary" || base == "varchar"
	}
	switch strings.ToLower(strings.TrimSpace(charset)) {
	case "latin1", "latin2", "ascii", "cp1250", "cp1251", "cp1252", "binary", "us7ascii", "we8iso8859p1":
		return true
	}
	return false
}

func formatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
