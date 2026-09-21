export const DATA_GRID_DISPLAY_RENDER_VERSION = Symbol('DATA_GRID_DISPLAY_RENDER_VERSION');

type DisplayRenderRowCacheEntry = {
  version: string;
  rendered: object[];
};

const displayRenderRowsCache = new WeakMap<object[], DisplayRenderRowCacheEntry>();

export const attachDataGridDisplayRenderVersion = <T extends object>(
  rows: T[],
  renderVersion: string,
): T[] => {
  if (!renderVersion) return rows;
  const cached = displayRenderRowsCache.get(rows);
  if (!cached) {
    displayRenderRowsCache.set(rows, { version: renderVersion, rendered: rows });
    return rows;
  }
  if (cached.version === renderVersion) return cached.rendered as T[];

  const renderedRows = rows.map((row) => {
    const source = row as object;
    const rendered = { ...source } as T;
    Object.defineProperty(rendered, DATA_GRID_DISPLAY_RENDER_VERSION, {
      value: renderVersion,
      enumerable: true,
    });
    return rendered;
  });
  displayRenderRowsCache.set(rows, { version: renderVersion, rendered: renderedRows });
  return renderedRows;
};

export const hasDataGridDisplayRenderVersionChanged = (
  nextRecord: unknown,
  previousRecord: unknown,
): boolean => {
  const nextVersion = nextRecord && typeof nextRecord === 'object'
    ? (nextRecord as Record<symbol, unknown>)[DATA_GRID_DISPLAY_RENDER_VERSION]
    : undefined;
  const previousVersion = previousRecord && typeof previousRecord === 'object'
    ? (previousRecord as Record<symbol, unknown>)[DATA_GRID_DISPLAY_RENDER_VERSION]
    : undefined;
  return nextVersion !== previousVersion;
};
