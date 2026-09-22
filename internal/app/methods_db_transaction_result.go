package app

import (
	"strings"

	"GoNavi-Wails/internal/connection"
)

func summarizeManagedSQLResultSet(resultSet connection.ResultSetData) (rowsAffected, rowsReturned int64) {
	if !isAffectedRowsResultSet(resultSet) {
		return 0, int64(len(resultSet.Rows))
	}
	for _, row := range resultSet.Rows {
		value, ok := row["affectedRows"]
		if !ok {
			for key, candidate := range row {
				if strings.EqualFold(strings.TrimSpace(key), "affectedRows") {
					value = candidate
					ok = true
					break
				}
			}
		}
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case int:
			rowsAffected += int64(typed)
		case int32:
			rowsAffected += int64(typed)
		case int64:
			rowsAffected += typed
		case uint:
			rowsAffected += int64(typed)
		case uint32:
			rowsAffected += int64(typed)
		case uint64:
			if typed <= uint64(^uint64(0)>>1) {
				rowsAffected += int64(typed)
			}
		case float64:
			rowsAffected += int64(typed)
		}
	}
	return rowsAffected, 0
}
