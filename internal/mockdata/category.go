package mockdata

import (
	"strconv"
	"strings"
)

// Category 是列的取值类别，决定可用的生成规则。
type Category string

// 取值类别。Binary 与 Unsupported 只能留空或填固定值。
const (
	CategoryInteger     Category = "integer"
	CategoryDecimal     Category = "decimal"
	CategoryFloat       Category = "float"
	CategoryString      Category = "string"
	CategoryText        Category = "text"
	CategoryBoolean     Category = "boolean"
	CategoryDate        Category = "date"
	CategoryTime        Category = "time"
	CategoryDateTime    Category = "datetime"
	CategoryYear        Category = "year"
	CategoryUUID        Category = "uuid"
	CategoryJSON        Category = "json"
	CategoryEnum        Category = "enum"
	CategorySet         Category = "set"
	CategoryBit         Category = "bit"
	CategoryInet        Category = "inet"
	CategoryBinary      Category = "binary"
	CategoryUnsupported Category = "unsupported"
)

var categoryByBase = map[string]Category{
	"decimal": CategoryDecimal, "numeric": CategoryDecimal, "number": CategoryDecimal, "dec": CategoryDecimal,
	"money": CategoryDecimal, "smallmoney": CategoryDecimal, "decimal32": CategoryDecimal, "decimal64": CategoryDecimal,
	"decimal128": CategoryDecimal, "decimal256": CategoryDecimal,

	"float": CategoryFloat, "double": CategoryFloat, "real": CategoryFloat, "float4": CategoryFloat,
	"float8": CategoryFloat, "double precision": CategoryFloat, "binary_float": CategoryFloat,
	"binary_double": CategoryFloat, "float32": CategoryFloat, "float64": CategoryFloat, "smallfloat": CategoryFloat,

	"char": CategoryString, "varchar": CategoryString, "varchar2": CategoryString, "nvarchar": CategoryString,
	"nvarchar2": CategoryString, "nchar": CategoryString, "character": CategoryString,
	"character varying": CategoryString, "national character varying": CategoryString,
	"national char": CategoryString, "citext": CategoryString, "fixedstring": CategoryString,
	"lvarchar": CategoryString, "symbol": CategoryString, "varchar_ignorecase": CategoryString,

	"text": CategoryText, "tinytext": CategoryText, "mediumtext": CategoryText, "longtext": CategoryText,
	"clob": CategoryText, "nclob": CategoryText, "ntext": CategoryText, "string": CategoryText,
	"long varchar": CategoryText, "blob sub_type text": CategoryText,

	"bool": CategoryBoolean, "boolean": CategoryBoolean,

	"date": CategoryDate, "date32": CategoryDate,
	"time": CategoryTime, "time without time zone": CategoryTime, "time with time zone": CategoryTime,
	"timetz":   CategoryTime,
	"datetime": CategoryDateTime, "datetime2": CategoryDateTime, "smalldatetime": CategoryDateTime,
	"datetimeoffset": CategoryDateTime, "timestamp": CategoryDateTime,
	"timestamp without time zone": CategoryDateTime, "timestamp with time zone": CategoryDateTime,
	"timestamp with local time zone": CategoryDateTime, "timestamptz": CategoryDateTime,
	"datetime64": CategoryDateTime, "timestamp_ns": CategoryDateTime, "timestamp_ms": CategoryDateTime,
	"timestamp_s": CategoryDateTime,
	"year":        CategoryYear,

	"uuid": CategoryUUID, "uniqueidentifier": CategoryUUID,
	"json": CategoryJSON, "jsonb": CategoryJSON,
	"enum": CategoryEnum, "enum8": CategoryEnum, "enum16": CategoryEnum,
	"set": CategorySet,
	"bit": CategoryBit, "bit varying": CategoryBit, "varbit": CategoryBit,
	"inet": CategoryInet, "cidr": CategoryInet, "ipv4": CategoryInet,

	"binary": CategoryBinary, "varbinary": CategoryBinary, "blob": CategoryBinary, "tinyblob": CategoryBinary,
	"mediumblob": CategoryBinary, "longblob": CategoryBinary, "bytea": CategoryBinary, "raw": CategoryBinary,
	"long raw": CategoryBinary, "image": CategoryBinary, "bfile": CategoryBinary,
}

// integerBits 是整数类型的位宽；ClickHouse 族的 IntN/UIntN 另按位数解析。
var integerBits = map[string]int{
	"tinyint": 8, "int1": 8, "byte": 8, "byteint": 8, "utinyint": 8,
	"smallint": 16, "int2": 16, "short": 16, "smallserial": 16, "serial2": 16, "usmallint": 16,
	"mediumint": 24,
	"int":       32, "integer": 32, "int4": 32, "serial": 32, "serial4": 32, "pls_integer": 32,
	"binary_integer": 32, "uinteger": 32, "simple_integer": 32,
	"bigint": 64, "int8": 64, "long": 64, "bigserial": 64, "serial8": 64, "ubigint": 64, "int64": 64,
	"hugeint": 128, "uhugeint": 128, "int128": 128,
}

var unsignedIntegerBases = map[string]bool{
	"utinyint": true, "usmallint": true, "uinteger": true, "ubigint": true, "uhugeint": true,
}

// resolveCategory 给出类别；同名类型在不同族含义不同的情况在这里分流。
func resolveCategory(family Family, parsed columnType) Category {
	if parsed.Array {
		return CategoryUnsupported
	}
	base := parsed.Base
	if bits := clickHouseIntBits(family, base); bits > 0 {
		return CategoryInteger
	}
	if category, ok := familyCategoryOverride(family, parsed); ok {
		return category
	}
	if _, ok := integerBits[base]; ok {
		return CategoryInteger
	}
	if category, ok := categoryByBase[base]; ok {
		if category == CategoryDecimal && decimalIsInteger(base, parsed) {
			return CategoryInteger
		}
		return category
	}
	return CategoryUnsupported
}

// familyCategoryOverride 处理同名类型在某个族里含义不同的情况。
func familyCategoryOverride(family Family, parsed columnType) (Category, bool) {
	base := parsed.Base
	switch {
	case family == FamilyOracle && base == "long":
		return CategoryText, true
	case family == FamilyOracle && base == "date":
		// Oracle DATE 带时分秒；达梦的 DATE 只有日期，单独成族。
		return CategoryDateTime, true
	case family == FamilySQLServer && (base == "timestamp" || base == "rowversion"):
		// SQL Server 的 timestamp 是行版本号，不能写入。
		return CategoryUnsupported, true
	case (family == FamilySQLServer || family == FamilyIRIS) && base == "bit":
		return CategoryBoolean, true
	case family == FamilyTDengine && base == "binary":
		// TDengine 的 BINARY(n) 是单字节字符串。
		return CategoryString, true
	case family == FamilyMySQL && base == "tinyint" && len(parsed.Args) == 1 && strings.TrimSpace(parsed.Args[0]) == "1":
		// MySQL 的 BOOL/BOOLEAN 在元数据里显示为 tinyint(1)。
		return CategoryBoolean, true
	case family == FamilySQLite && base == "":
		// SQLite 未声明类型的列什么都能存。
		return CategoryText, true
	case family == FamilyFirebird && (base == "blob sub_type text" || base == "blob sub_type 1"):
		return CategoryText, true
	case family == FamilyInformix && strings.HasPrefix(base, "datetime year to"):
		return CategoryDateTime, true
	case family == FamilyInformix && strings.HasPrefix(base, "datetime hour to"):
		return CategoryTime, true
	}
	return "", false
}

// clickHouseIntBits 解析 ClickHouse 族的 Int8…Int256、UInt8…UInt256；其他族返回 0。
func clickHouseIntBits(family Family, base string) int {
	if family != FamilyClickHouse {
		return 0
	}
	name := strings.TrimPrefix(base, "u")
	if !strings.HasPrefix(name, "int") {
		return 0
	}
	bits, err := strconv.Atoi(name[len("int"):])
	if err != nil || bits <= 0 {
		return 0
	}
	return bits
}

// decimalIsInteger 判断 NUMBER(p)、NUMBER(*,0)、DECIMAL(p,0) 这类小数位为 0 的定点数，按整数生成。
func decimalIsInteger(base string, parsed columnType) bool {
	switch base {
	case "money", "smallmoney", "decimal32", "decimal64", "decimal128", "decimal256":
		return false
	}
	if len(parsed.Args) == 0 {
		return false
	}
	if _, ok := parsed.intArg(0); !ok && strings.TrimSpace(parsed.Args[0]) != "*" {
		return false
	}
	if len(parsed.Args) == 1 {
		// NUMBER(p) / DECIMAL(p)：小数位默认 0。
		return true
	}
	scale, ok := parsed.intArg(1)
	return ok && scale == 0
}
