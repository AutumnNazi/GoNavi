package db

import (
	"fmt"
	"strings"
)

// FormatOracleColumnType formats Oracle dictionary metadata without losing explicit length semantics.
// Missing CHAR_USED keeps the legacy unqualified length rather than guessing a session default.
func FormatOracleColumnType(row map[string]interface{}) string {
	dataType := oracleRowString(row, "DATA_TYPE", "TYPE_NAME")
	if dataType == "" || strings.Contains(dataType, "(") {
		return dataType
	}

	upperType := strings.ToUpper(dataType)
	if upperType == "CHAR" || upperType == "VARCHAR" || upperType == "VARCHAR2" {
		switch strings.ToUpper(oracleRowString(row, "CHAR_USED")) {
		case "C":
			if length, ok := oracleRowInt(row, "CHAR_LENGTH", "CHAR_COL_DECL_LENGTH"); ok && length > 0 {
				return fmt.Sprintf("%s(%d CHAR)", dataType, length)
			}
		case "B":
			if length, ok := oracleRowInt(row, "DATA_LENGTH"); ok && length > 0 {
				return fmt.Sprintf("%s(%d BYTE)", dataType, length)
			}
		}
	}
	if isOracleLengthQualifiedType(upperType) {
		if charLength, ok := oracleRowInt(row, "CHAR_LENGTH", "CHAR_COL_DECL_LENGTH"); ok && charLength > 0 {
			return fmt.Sprintf("%s(%d)", dataType, charLength)
		}
		if dataLength, ok := oracleRowInt(row, "DATA_LENGTH"); ok && dataLength > 0 {
			return fmt.Sprintf("%s(%d)", dataType, dataLength)
		}
	}

	if strings.Contains(upperType, "NUMBER") || strings.Contains(upperType, "DECIMAL") || strings.Contains(upperType, "NUMERIC") {
		precision, hasPrecision := oracleRowInt(row, "DATA_PRECISION", "NUMERIC_PRECISION")
		if hasPrecision && precision > 0 {
			scale, hasScale := oracleRowInt(row, "DATA_SCALE", "NUMERIC_SCALE")
			// 负 scale 必须保留：Oracle 的 NUMBER(10,-2) 表示向左舍入到百位，
			// 丢掉负号会当成 NUMBER(10) 从而改变精度语义。跨方言迁移时由
			// 归一层把负 scale 折算成目标库合法的写法。
			if hasScale && scale != 0 {
				return fmt.Sprintf("%s(%d,%d)", dataType, precision, scale)
			}
			return fmt.Sprintf("%s(%d)", dataType, precision)
		}
	}

	return dataType
}
