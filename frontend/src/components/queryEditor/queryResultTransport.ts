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

/** 带预算查询的压缩变体：列名只传一次 + gzip，用于「不限」可能返回的超大结果集。 */
export const QUERY_EDITOR_BUDGETED_QUERY_COMPACT_METHOD = 'DBQueryMultiWithOptionsCompact';
/** 未压缩变体，作为压缩变体不可用时的兜底。 */
export const QUERY_EDITOR_BUDGETED_QUERY_METHOD = 'DBQueryMultiWithOptions';

/**
 * Runs a desktop query that must carry a server-side result budget.
 *
 * 预算只能由 WithOptions 系列承载（`DBQueryMultiCompact` 只接受四个基础参数）。
 * 这里优先选**带预算的压缩变体**：放开「不限」后结果集可达百万行量级，未压缩通道
 * 会把整份 JSON 内联成一条 JS 字面量交给前端一次性解析，正是压缩变体要避免的。
 *
 * 三级回退保证跨版本可用：压缩变体 → 未压缩变体 → 调用方传入的静态绑定。
 * 返回值统一交给 `expandCompactQueryResult`，它对未压缩结果幂等。
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
  const resolveWindowMethod = (name: string) => {
    if (typeof window === 'undefined') return undefined;
    const method = (window as Window & {
      go?: { app?: { App?: Record<string, unknown> } };
    }).go?.app?.App?.[name];
    return typeof method === 'function'
      ? (method as (...values: unknown[]) => Promise<T>)
      : undefined;
  };
  const invokeWails = () => {
    const compact = resolveWindowMethod(QUERY_EDITOR_BUDGETED_QUERY_COMPACT_METHOD);
    if (compact) return compact(...args);
    const plain = resolveWindowMethod(QUERY_EDITOR_BUDGETED_QUERY_METHOD);
    return plain ? plain(...args) : fallback();
  };
  return invokeRequestScopedApp
    ? invokeRequestScopedApp(QUERY_EDITOR_BUDGETED_QUERY_COMPACT_METHOD, args, invokeWails)
    : invokeWails();
};
