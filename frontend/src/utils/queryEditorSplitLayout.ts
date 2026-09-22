export const DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO = 0.5;
export const MIN_QUERY_EDITOR_EDITOR_HEIGHT_RATIO = 0.18;
export const MAX_QUERY_EDITOR_EDITOR_HEIGHT_RATIO = 0.85;
export const MIN_QUERY_EDITOR_EDITOR_HEIGHT = 100;
export const MIN_QUERY_EDITOR_RESULT_HEIGHT = 120;

export const sanitizeQueryEditorEditorHeightRatio = (value: unknown): number => {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) {
    return DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO;
  }
  return Math.min(
    MAX_QUERY_EDITOR_EDITOR_HEIGHT_RATIO,
    Math.max(MIN_QUERY_EDITOR_EDITOR_HEIGHT_RATIO, ratio),
  );
};

export const clampQueryEditorEditorHeight = (
  height: unknown,
  availableHeight: unknown,
): number => {
  const rawHeight = Number(height);
  const rawAvailableHeight = Number(availableHeight);
  const normalizedHeight = Number.isFinite(rawHeight) ? rawHeight : MIN_QUERY_EDITOR_EDITOR_HEIGHT;
  if (!Number.isFinite(rawAvailableHeight) || rawAvailableHeight <= 0) {
    return Math.max(MIN_QUERY_EDITOR_EDITOR_HEIGHT, Math.round(normalizedHeight));
  }
  const maxEditorHeight = Math.max(
    MIN_QUERY_EDITOR_EDITOR_HEIGHT,
    rawAvailableHeight - MIN_QUERY_EDITOR_RESULT_HEIGHT,
  );
  return Math.round(Math.max(
    MIN_QUERY_EDITOR_EDITOR_HEIGHT,
    Math.min(maxEditorHeight, normalizedHeight),
  ));
};

export const resolveQueryEditorEditorHeightFromRatio = (
  ratio: unknown,
  availableHeight: unknown,
): number => {
  const rawAvailableHeight = Number(availableHeight);
  if (!Number.isFinite(rawAvailableHeight) || rawAvailableHeight <= 0) {
    return MIN_QUERY_EDITOR_EDITOR_HEIGHT;
  }
  return clampQueryEditorEditorHeight(
    rawAvailableHeight * sanitizeQueryEditorEditorHeightRatio(ratio),
    rawAvailableHeight,
  );
};

export const resolveQueryEditorEditorHeightRatio = (
  editorHeight: unknown,
  availableHeight: unknown,
): number => {
  const rawEditorHeight = Number(editorHeight);
  const rawAvailableHeight = Number(availableHeight);
  if (
    !Number.isFinite(rawEditorHeight)
    || !Number.isFinite(rawAvailableHeight)
    || rawAvailableHeight <= 0
  ) {
    return DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO;
  }
  return sanitizeQueryEditorEditorHeightRatio(rawEditorHeight / rawAvailableHeight);
};

const queryEditorTabSplitRatios = new Map<string, number>();

/** 每个查询标签页自己的编辑区/结果区比例。没拖过的标签页回退到全局默认值。 */
export const resolveQueryEditorTabSplitRatio = (tabId: string, fallback: unknown): number => {
  const stored = queryEditorTabSplitRatios.get(String(tabId || '').trim());
  if (stored === undefined) {
    return sanitizeQueryEditorEditorHeightRatio(fallback);
  }
  return sanitizeQueryEditorEditorHeightRatio(stored);
};

export const setQueryEditorTabSplitRatio = (tabId: string, ratio: number): void => {
  const id = String(tabId || '').trim();
  if (!id) {
    return;
  }
  queryEditorTabSplitRatios.set(id, sanitizeQueryEditorEditorHeightRatio(ratio));
};

export const resetQueryEditorTabSplitRatiosForTests = (): void => {
  queryEditorTabSplitRatios.clear();
};
