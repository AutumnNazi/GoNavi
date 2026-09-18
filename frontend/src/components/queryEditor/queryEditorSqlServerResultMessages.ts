export type QueryEditorToastResultSet = {
  resultType?: 'grid' | 'message' | 'elasticsearch';
  columns?: unknown[];
  messages?: string[];
};

export type QueryEditorExecutionSuccessToast = {
  key: string;
  params?: Record<string, number>;
};

const SQLSERVER_DB_TYPES = new Set(['sqlserver', 'mssql', 'sql_server', 'sql-server']);
const SQLSERVER_DRIVER_PREFIX_RE = /^\s*mssql:\s?/i;

const IGNORABLE_SQLSERVER_NOTICE_RE = [
  /^changed database context to\b/i,
  /^changed language setting to\b/i,
  /^已将数据库上下文更改为/,
  /^已将语言设置更改为/,
  /^\(?\d+\s+row(?:s|\(s\))?\s+affected\)?\.?$/i,
  /^\d+\s*行受影响/,
];

export const isSqlServerResultDbType = (dbType: string): boolean => (
  SQLSERVER_DB_TYPES.has(String(dbType || '').trim().toLowerCase())
);

const noticeTextForIgnoreCheck = (message: string): string => (
  String(message || '').replace(SQLSERVER_DRIVER_PREFIX_RE, '').trim()
);

export const isIgnorableSqlServerResultNotice = (message: string): boolean => {
  const text = noticeTextForIgnoreCheck(message);
  if (!text) return false;
  return IGNORABLE_SQLSERVER_NOTICE_RE.some((pattern) => pattern.test(text));
};

export const filterSqlServerResultMessages = (messages: unknown): string[] => (
  (Array.isArray(messages) ? messages : [])
    .map((item) => String(item ?? ''))
    .filter((item) => !isIgnorableSqlServerResultNotice(item))
);

const isAffectedRowsResultSet = (result: QueryEditorToastResultSet): boolean => (
  Array.isArray(result.columns)
  && result.columns.length === 1
  && result.columns[0] === 'affectedRows'
);

export const countQueryEditorTabularResultSets = (
  resultSets: QueryEditorToastResultSet[],
): number => resultSets.filter((result) => (
  result.resultType !== 'message' && !isAffectedRowsResultSet(result)
)).length;

export const finalizeQueryEditorSqlServerResultSets = <T extends QueryEditorToastResultSet>(
  dbType: string,
  resultSets: T[],
): T[] => {
  if (!isSqlServerResultDbType(dbType)) {
    return resultSets;
  }
  return resultSets
    .map((result) => ({
      ...result,
      messages: filterSqlServerResultMessages(result.messages),
    }))
    .filter((result) => result.resultType !== 'message' || result.messages.length > 0);
};

export const resolveQueryEditorExecutionSuccessToast = (
  rawResultSetCount: number,
  resultSets: QueryEditorToastResultSet[],
): QueryEditorExecutionSuccessToast | null => {
  const tabularCount = countQueryEditorTabularResultSets(resultSets);
  if (tabularCount > 1) {
    return {
      key: 'query_editor.message.execution_result_sets_success',
      params: { results: tabularCount },
    };
  }
  if (rawResultSetCount > 1 && tabularCount === 1) {
    return {
      key: 'query_editor.message.execution_result_sets_success',
      params: { results: 1 },
    };
  }
  if (resultSets.length === 0) {
    return { key: 'query_editor.message.execution_success' };
  }
  return null;
};
