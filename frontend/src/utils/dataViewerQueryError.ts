import type { I18nParams } from '../i18n';
import { hasLocalizedSqlTimeoutKeyword } from './sqlErrorSemantics';

export type DataViewerQueryErrorTranslator = (
  key: string,
  params?: I18nParams,
) => string;

const QUERY_FAILED_FALLBACK = 'Query failed';
const QUERY_TIMEOUT_FALLBACK =
  'Query exceeded the connection timeout and was interrupted. Increase the connection timeout, or reduce the query scope and retry.';
const DUCKDB_QUERY_TIMEOUT_FALLBACK =
  'DuckDB query exceeded the connection timeout and was interrupted. Increase the connection timeout, or reduce the sort/filter scope and retry.';

const localize = (
  tr: DataViewerQueryErrorTranslator,
  key: string,
  fallback: string,
): string => {
  const translated = String(tr(key) || '').trim();
  return translated && translated !== key ? translated : fallback;
};

export function formatDataViewerQueryError(
  dbType: string,
  messageText: unknown,
  tr: DataViewerQueryErrorTranslator,
): string {
  const queryFailed = localize(tr, 'data_viewer.message.query_failed', QUERY_FAILED_FALLBACK);
  const rawMessage = String(messageText || queryFailed).trim() || queryFailed;
  const lower = rawMessage.toLowerCase();
  const isTimeout =
    lower.includes('context deadline exceeded')
    || lower.includes('deadline exceeded')
    || lower.includes('timeout')
    || lower.includes('timed out')
    || hasLocalizedSqlTimeoutKeyword(rawMessage);
  const dbTypeLower = String(dbType || '').trim().toLowerCase();
  const isDuckDBInterrupted =
    dbTypeLower === 'duckdb' && (lower.includes('interrupt error') || lower.includes('interrupted'));
  if (isTimeout || isDuckDBInterrupted) {
    if (dbTypeLower === 'duckdb') {
      return localize(tr, 'data_viewer.message.duckdb_query_timeout', DUCKDB_QUERY_TIMEOUT_FALLBACK);
    }
    return localize(tr, 'data_viewer.message.query_timeout', QUERY_TIMEOUT_FALLBACK);
  }
  return rawMessage;
}
