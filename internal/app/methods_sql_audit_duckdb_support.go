package app

import (
	"strings"
)

func containsSQLAuditWrite(dbType string, query string) bool {
	statements := splitSQLStatementsForDialect(dbType, query)
	if len(statements) == 0 {
		return !isReadOnlySQLQuery(dbType, query)
	}
	for _, statement := range statements {
		statement = strings.TrimSpace(statement)
		if statement != "" && !isReadOnlySQLQuery(dbType, statement) {
			return true
		}
	}
	return false
}
