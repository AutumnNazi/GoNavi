import { gunzipSync, strFromU8 } from 'fflate';

type CompactResultSet = {
  columns?: unknown;
  rows?: unknown;
  rowValues?: unknown;
  [key: string]: unknown;
};

const COMPACT_QUERY_RESULT_ENCODING = 'gzip-base64-json';

const decodeBase64 = (value: string): Uint8Array => {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
};

const decodeCompactResultData = (result: Record<string, unknown>): Record<string, unknown> => {
  if (
    result.dataEncoding !== COMPACT_QUERY_RESULT_ENCODING
    || typeof result.encodedData !== 'string'
  ) return result;

  const decoded = decodeBase64(result.encodedData);
  const inflated = gunzipSync(decoded);
  const data = JSON.parse(strFromU8(inflated));
  const { dataEncoding: _dataEncoding, encodedData: _encodedData, ...rest } = result;
  return { ...rest, data };
};

export const expandCompactQueryResult = <T>(result: T): T => {
  if (!result || typeof result !== 'object') return result;
  const raw = result as Record<string, unknown>;
  const container = decodeCompactResultData(raw) as { data?: unknown };
  if (!Array.isArray(container.data)) {
    return container as T;
  }

  let changed = false;
  const data = container.data.map((rawResultSet) => {
    if (!rawResultSet || typeof rawResultSet !== 'object') return rawResultSet;
    const resultSet = rawResultSet as CompactResultSet;
    if (!Array.isArray(resultSet.rowValues) || !Array.isArray(resultSet.columns)) return rawResultSet;
    const columns = resultSet.columns.map((column) => String(column));
    const rows = resultSet.rowValues.map((rawValues) => {
      const values = Array.isArray(rawValues) ? rawValues : [];
      return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    });
    const { rowValues: _rowValues, ...rest } = resultSet;
    changed = true;
    return { ...rest, columns, rows };
  });

  return changed ? { ...container, data } as T : container as T;
};

export const invokeCompactDBQueryMulti = <T>(
  args: [unknown, string, string, string],
  fallback: () => Promise<T>,
  invokeRequestScopedApp?: (
    method: string,
    values: unknown[],
    wailsFallback: () => Promise<T>,
  ) => Promise<T>,
): Promise<T> => {
  const invokeWails = () => {
    if (typeof window === 'undefined') return fallback();
    const method = (window as Window & {
      go?: { app?: { App?: { DBQueryMultiCompact?: (...values: unknown[]) => Promise<T> } } };
    }).go?.app?.App?.DBQueryMultiCompact;
    return typeof method === 'function' ? method(...args) : fallback();
  };
  return invokeRequestScopedApp
    ? invokeRequestScopedApp('DBQueryMultiCompact', args, invokeWails)
    : invokeWails();
};

/**
 * Runs a desktop query that must carry a server-side result budget.
 *
 * The compact transport cannot forward it: `DBQueryMultiCompact` only accepts
 * the four base arguments, and the budget is bound by the WithOptions method.
 * This therefore routes to WithOptions over both transports instead of the
 * compact fast path, so the scan-layer budget is actually enforced.
 */
export const invokeBudgetedDBQueryMulti = <T>(
  args: [unknown, string, string, string, unknown],
  fallback: () => Promise<T>,
  invokeRequestScopedApp?: (
    method: string,
    values: unknown[],
    wailsFallback: () => Promise<T>,
  ) => Promise<T>,
): Promise<T> => {
  const methodName = 'DBQueryMultiWithOptions';
  const invokeWails = () => {
    if (typeof window === 'undefined') return fallback();
    const method = (window as Window & {
      go?: { app?: { App?: Record<string, unknown> } };
    }).go?.app?.App?.[methodName];
    return typeof method === 'function'
      ? (method as (...values: unknown[]) => Promise<T>)(...args)
      : fallback();
  };
  return invokeRequestScopedApp
    ? invokeRequestScopedApp(methodName, args, invokeWails)
    : invokeWails();
};
