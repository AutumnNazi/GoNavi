package db

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
)

const characterLengthSemanticsProbeSQL = `SELECT CAST('中文' AS VARCHAR(2 CHAR)) AS gonavi_varchar_char,
CAST('中文' AS CHAR(2 CHAR)) AS gonavi_char_char,
CAST('ab' AS VARCHAR(2 BYTE)) AS gonavi_varchar_byte,
CAST('ab' AS CHAR(2 BYTE)) AS gonavi_char_byte`

// ProbeCharacterLengthSemantics 用固定只读查询验证显式长度限定及中文字符容量。
// 结果只描述当前连接的探测能力；调用方应在失败时保守回退，不推断产品版本。
func ProbeCharacterLengthSemantics(database Database) (bool, error) {
	if database == nil || (reflect.ValueOf(database).Kind() == reflect.Ptr && reflect.ValueOf(database).IsNil()) {
		return false, errors.New("probe character length semantics: nil database")
	}
	var rows []map[string]interface{}
	var err error
	if query, ok := database.(QueryContexter); ok {
		rows, _, err = query.QueryContext(metadataContextFor(database), characterLengthSemanticsProbeSQL)
	} else {
		rows, _, err = database.Query(characterLengthSemanticsProbeSQL)
	}
	if err != nil {
		return false, fmt.Errorf("probe character length semantics: %w", err)
	}
	if len(rows) != 1 {
		return false, fmt.Errorf("probe character length semantics: expected one result row")
	}
	for column, expected := range map[string]string{
		"gonavi_varchar_char": "中文",
		"gonavi_char_char":    "中文",
		"gonavi_varchar_byte": "ab",
		"gonavi_char_byte":    "ab",
	} {
		if !characterLengthProbeMatches(rows[0], column, expected) {
			return false, fmt.Errorf("probe character length semantics: unexpected result for %s", column)
		}
	}
	return true, nil
}

func characterLengthProbeMatches(row map[string]interface{}, column, expected string) bool {
	for name, value := range row {
		if !strings.EqualFold(name, column) {
			continue
		}
		switch text := value.(type) {
		case string:
			return text == expected
		case []byte:
			return string(text) == expected
		default:
			return false
		}
	}
	return false
}
