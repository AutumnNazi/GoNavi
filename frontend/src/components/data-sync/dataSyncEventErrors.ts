import type { DataSyncErrorRow, DataSyncRunEvent } from './model';

export function runEventPayload(value: unknown): Record<string, unknown> {
  if(typeof value === 'string') {
    try { return runEventPayload(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const terminalTypes = new Set(['failed', 'partial', 'interrupted', 'canceled']);

export function hasRunEventError(event: DataSyncRunEvent): boolean {
  const payload = runEventPayload(event.payload);
  return event.type === 'error_row' || terminalTypes.has(event.type)
    || (event.type === 'log' && (payload.level === 'error' || Boolean(text(payload.error))));
}

export function resolveRunEventError(event: DataSyncRunEvent, rows: readonly DataSyncErrorRow[]) {
  const payload = runEventPayload(event.payload);
  // Only error_row payload.id is a persisted row reference. Sequence, table,
  // message, and errorCode are not identities and must never be joined on.
  const rowId = event.type === 'error_row' ? text(payload.id) : '';
  const runScope = terminalTypes.has(event.type);
  const relatedRows = rows.filter((row) => row.runId === event.runId
    && (runScope || (Boolean(rowId) && row.id === rowId)));
  return {
    runScope,
    rows: relatedRows,
    code: text(payload.errorCode),
    messages: [...new Set([text(event.message), text(payload.error), text(payload.message)].filter(Boolean))],
  };
}
