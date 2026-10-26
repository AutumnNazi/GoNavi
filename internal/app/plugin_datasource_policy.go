package app

import (
	"errors"
	"strings"

	"GoNavi-Wails/internal/plugin"
)

// Invalid plugin identities must never acquire a built-in policy dialect.
const invalidPluginDataSourceDialect = "plugin:invalid"

// isPluginDataSourceType reserves the namespace even when the identity is invalid
// or its plugin is unavailable. Detection must not make that identity canonical.
func isPluginDataSourceType(value string) bool {
	value = strings.TrimSpace(value)
	return strings.EqualFold(value, "plugin") || (len(value) >= len("plugin:") && strings.EqualFold(value[:len("plugin:")], "plugin:"))
}

// pluginDataSourceDialect returns only the immutable suffix of a strict identity.
// It does not resolve availability or alias the type to a built-in driver.
func pluginDataSourceDialect(value string) (string, bool) {
	_, _, dialect, ok := plugin.ParseDataSourceType(value)
	return dialect, ok
}

// validatePluginReadOnlyQuery is shared with the adapter's read-only callback.
// An unavailable identity still has policy, but an invalid one cannot execute SQL.
func validatePluginReadOnlyQuery(typeName, query string, text func(string, map[string]any) string) error {
	dialect, ok := pluginDataSourceDialect(typeName)
	if !ok {
		return errors.New(readOnlyConnectionQueryBlockedMessageWithText(text))
	}
	statements := splitSQLStatementsForDialect(dialect, query)
	if len(statements) == 0 {
		return errors.New(readOnlyConnectionQueryBlockedMessageWithText(text))
	}
	for _, statement := range statements {
		if !isReadOnlySQLQuery(dialect, statement) || !pluginReadOnlyStatement(dialect, statement) {
			return errors.New(readOnlyConnectionQueryBlockedMessageWithText(text))
		}
	}
	return nil
}

func pluginReadOnlyStatement(dialect, statement string) bool {
	keyword, _ := sqlDataOperationInfo(statement, dialect)
	switch keyword {
	case "explain":
		return pluginReadOnlyExplain(dialect, statement)
	case "select", "show", "describe", "desc", "values", "pragma":
		return true
	default:
		// An unresolved WITH or a command from another engine is not known read-only SQL.
		return false
	}
}

func pluginReadOnlyExplain(dialect, statement string) bool {
	_, pos := nextSQLKeyword(statement, 0)
	pos = skipSQLTrivia(statement, pos)
	if pos < len(statement) && statement[pos] == '(' {
		pos = skipBalancedSQLParens(statement, pos, dialect)
		if dialect != "postgres" || pos < 0 {
			return false
		}
	}
	for pos < len(statement) {
		pos = skipSQLTrivia(statement, pos)
		keyword, next := nextSQLKeyword(statement, pos)
		switch keyword {
		case "analyze", "analyse", "verbose", "extended", "partitions":
			pos = next
		case "query":
			option, end := nextSQLKeyword(statement, next)
			if dialect != "sqlite" || option != "plan" {
				return false
			}
			pos = end
		case "format":
			pos = skipSQLTrivia(statement, next)
			if dialect != "mysql" || pos >= len(statement) || statement[pos] != '=' {
				return false
			}
			format, end := nextSQLKeyword(statement, pos+1)
			if format != "json" && format != "tree" && format != "traditional" {
				return false
			}
			pos = end
		case "select", "with", "values", "show", "describe", "desc", "pragma":
			body := statement[pos:]
			return isReadOnlySQLQuery(dialect, body) && pluginReadOnlyStatement(dialect, body)
		default:
			return false
		}
	}
	return false
}
