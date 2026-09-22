export const QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS = 50_000;
export const QUERY_EDITOR_SAFE_MAX_RESULT_BYTES = 24 * 1024 * 1024;
export const QUERY_EDITOR_SAFE_MAX_FIELD_BYTES = 1024 * 1024;

export type QueryEditorResultBudgetOptions = {
  maxRowsPerResult: number;
  maxTotalRows: number;
  maxTotalBytes: number;
  maxFieldBytes: number;
};

export const buildQueryEditorResultBudgetOptions = (
  configuredMaxRows: number | null | undefined,
): QueryEditorResultBudgetOptions => {
  const parsed = Math.trunc(Number(configuredMaxRows) || 0);
  const maxRows = parsed > 0
    ? Math.min(parsed, QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS)
    : QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS;
  return {
    maxRowsPerResult: maxRows,
    maxTotalRows: maxRows,
    maxTotalBytes: QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
    maxFieldBytes: QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
  };
};
