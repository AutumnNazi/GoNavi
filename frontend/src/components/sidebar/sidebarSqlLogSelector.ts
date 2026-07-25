import type { SqlLog } from '../../store';

const EMPTY_SIDEBAR_SQL_LOGS: SqlLog[] = [];
const SIDEBAR_RECENT_SQL_LOG_LIMIT = 5;

export const selectSidebarCommandSearchSqlLogs = (
  state: { sqlLogs: SqlLog[] },
  enabled: boolean,
): SqlLog[] => (enabled ? state.sqlLogs : EMPTY_SIDEBAR_SQL_LOGS);

export const selectRecentSidebarSqlLogs = (sqlLogs: SqlLog[]): SqlLog[] => (
  sqlLogs
    .filter((log) => !log.hiddenFromRecent)
    .slice(0, SIDEBAR_RECENT_SQL_LOG_LIMIT)
);
