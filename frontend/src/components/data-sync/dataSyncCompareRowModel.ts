import type { DataSyncTableDiffSummary, DataSyncCompareMode } from './model';
export function describeCompareRow(summary: DataSyncTableDiffSummary, compareMode?: DataSyncCompareMode) {
  const missingColumns = summary.missingColumns || [];
  const columnDiffs = summary.columnDiffs || [];
  const effectiveMode: DataSyncCompareMode =
    compareMode || 'data';
  const showData = effectiveMode === 'data' || effectiveMode === 'both';
  const showSchema =
    effectiveMode === 'schema' ||
    effectiveMode === 'both' ||
    summary.hasSchema === true;
  const hasSchemaDiff =
    (summary.schemaDiffCount ?? 0) > 0 ||
    missingColumns.length > 0 ||
    columnDiffs.length > 0;
  // A data-only compare shows no structure section, but a column gap
  // still blocks a later sync, so it degrades to one inline warning
  // instead of vanishing the way it used to.
  const schemaWarningOnly = !showSchema && hasSchemaDiff;
  // Analyze has many per-table early exits (target missing,
  // unrepairable schema diff, no key for the diff, source/target read
  // failure) that only set Message and leave every counter at 0.
  // Without canSync those rows rendered a green "identical" badge for
  // a table that was never actually compared.
  const notCompared = summary.canSync === false;
  const hasDiff =
    (showData &&
      (summary.inserts > 0 ||
        summary.updates > 0 ||
        summary.deletes > 0)) ||
    hasSchemaDiff;
  const status = notCompared
    ? 'unknown'
    : hasDiff
      ? 'diff'
      : 'same';
  // Analyze exposes a human summary and a structured field diff for
  // the same schema gap. Keep the structured list authoritative and
  // suppress only the known duplicate summary wording; unrelated
  // warnings/errors remain visible.
  const hasStructuredSchemaDetail =
    columnDiffs.length > 0 || missingColumns.length > 0;
  const isDuplicateSchemaSummary = (value: string): boolean =>
    hasStructuredSchemaDetail &&
    /(?:目标(?:表)?缺失\s*(?:\d+\s*个?)?\s*(?:字段|列)|(?:target\s+)?(?:table\s+)?(?:is\s+)?missing\s+(?:\d+\s+)?(?:columns?|fields?))/i.test(
      value,
    );
  const message =
    summary.message && !isDuplicateSchemaSummary(summary.message)
      ? summary.message
      : '';
  const warnings = (summary.warnings || []).filter(
    (warning) => !isDuplicateSchemaSummary(warning),
  );
  return { missingColumns, columnDiffs, showData, showSchema, schemaWarningOnly, notCompared, hasDiff, status, message, warnings };
}
