package app

import (
	"errors"
	"regexp"
	"strings"

	"GoNavi-Wails/internal/connection"
)

var databaseJobCallPattern = regexp.MustCompile(`(?i)\b(?:cron\s*\.\s*(?:schedule|schedule_in_database|alter_job|unschedule)|(?:dbms_scheduler|dbms_job|dbe_task|pkg_service)\s*\.\s*(?:create_job|set_attribute|set_attribute_null|set_job_argument_value|enable|disable|run_job|stop_job|drop_job|submit|change|what|interval|next_date|broken|remove|run|update|cancel|finish|job_submit|job_update|job_cancel|job_finish)|sp_(?:create_job|alter_job|rename_job|enable_job|drop_job|job_config_start|job_config_commit|add_job_step|alter_job_step|drop_job_step|add_job_schedule|alter_job_schedule|drop_job_schedule|dbms_job_run|dbms_job_run_async|stop_running_job))\s*\(`)

// hasDatabaseJobMutationSQL recognizes scheduler side effects even behind SELECT.
// Quoted identifiers are retained; literals and comments cannot trigger a match.
func hasDatabaseJobMutationSQL(dbType, query string) bool {
	var tokens strings.Builder
	for pos := 0; pos < len(query); {
		if query[pos] == '"' || query[pos] == '`' {
			end := skipSQLDelimited(query, pos, query[pos])
			if end > pos+1 {
				tokens.WriteString(query[pos+1 : end-1])
				pos = end
				continue
			}
		}
		if next, ok := skipSQLQuotedOrComment(query, pos, dbType); ok {
			tokens.WriteByte(' ')
			pos = next
			continue
		}
		tokens.WriteByte(query[pos])
		pos++
	}
	return databaseJobCallPattern.MatchString(tokens.String())
}

func isDatabaseJobMutationProtected(config connection.ConnectionConfig) bool {
	protection := resolveConnectionProtectionConfig(config)
	return config.ReadOnly || protection.RestrictDataEdit || protection.RestrictStructureEdit || protection.RestrictScriptExecution || protection.RestrictDataImport
}

func ensureConnectionAllowsJobManagement(config connection.ConnectionConfig, source string) error {
	if source == "database_jobs" && isDatabaseJobMutationProtected(config) {
		return errors.New(readOnlyConnectionQueryBlockedMessage())
	}
	return nil
}

func ensureConnectionAllowsJobQuery(config connection.ConnectionConfig, query, source string) error {
	if err := ensureConnectionAllowsQuery(config, query); err != nil {
		return err
	}
	return ensureConnectionAllowsJobManagement(config, source)
}
