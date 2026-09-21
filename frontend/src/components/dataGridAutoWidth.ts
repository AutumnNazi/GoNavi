const AUTO_FIT_DEFAULT_MIN_WIDTH = 80;
const AUTO_FIT_DEFAULT_MAX_WIDTH = 720;
const AUTO_FIT_DEFAULT_PADDING = 20;
const AUTO_FIT_DEFAULT_SAMPLE_LIMIT = 200;
/**
 * Total number of cell measurements one auto-fit pass is allowed to make.
 * Derived from the measured cost of `measureText`: a budget of ~1200 keeps the
 * synchronous pass in the low tens of milliseconds on a warm canvas, while
 * "200 rows for every column" reached tens of thousands of calls and delayed
 * the first paint by hundreds of milliseconds to several seconds.
 */
const AUTO_FIT_MEASURE_BUDGET = 1200;
const AUTO_FIT_MIN_SAMPLE_LIMIT = 8;
const AUTO_FIT_MAX_PREVIEW_CHARS = 120;

/**
 * Splits the auto-fit measurement budget across the columns being measured.
 * Narrow result sets keep the full per-column sample; wide ones sample fewer
 * rows per column so the first paint does not scale with column count x rows.
 */
export const resolveAutoFitSampleLimit = (columnCount: number): number => {
  const columns = Number.isFinite(columnCount) ? Math.max(0, Math.floor(columnCount)) : 0;
  if (columns === 0) return 0;
  const perColumn = Math.floor(AUTO_FIT_MEASURE_BUDGET / columns);
  return Math.min(AUTO_FIT_DEFAULT_SAMPLE_LIMIT, Math.max(AUTO_FIT_MIN_SAMPLE_LIMIT, perColumn));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

const clampWidth = (value: number, minWidth: number, maxWidth: number) => {
  const safeMin = Math.max(1, Math.floor(minWidth));
  const safeMax = Math.max(safeMin, Math.floor(maxWidth));
  return Math.min(safeMax, Math.max(safeMin, Math.ceil(value)));
};

const normalizePreviewLine = (value: string): string => {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n');
  if (normalized.length <= AUTO_FIT_MAX_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, AUTO_FIT_MAX_PREVIEW_CHARS)}…`;
};

const splitPreviewLines = (value: string): string[] => {
  return normalizePreviewLine(value)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
};

export const normalizeAutoFitCellText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return normalizePreviewLine(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length > 80) {
      return `[Array(${value.length})]`;
    }
    try {
      return normalizePreviewLine(JSON.stringify(value));
    } catch {
      return '[Array]';
    }
  }

  if (isPlainObject(value)) {
    const topLevelSize = Object.keys(value).length;
    if (topLevelSize > 80) {
      return `{Object(${topLevelSize})}`;
    }
    try {
      return normalizePreviewLine(JSON.stringify(value));
    } catch {
      return '[Object]';
    }
  }

  return normalizePreviewLine(String(value));
};

export const calculateAutoFitColumnWidth = ({
  headerTexts,
  valueTexts,
  measureHeaderText,
  measureCellText,
  minWidth = AUTO_FIT_DEFAULT_MIN_WIDTH,
  maxWidth = AUTO_FIT_DEFAULT_MAX_WIDTH,
  padding = AUTO_FIT_DEFAULT_PADDING,
  sampleLimit = AUTO_FIT_DEFAULT_SAMPLE_LIMIT,
  defaultWidth,
}: {
  headerTexts: Array<string | null | undefined>;
  valueTexts: unknown[];
  measureHeaderText: (text: string) => number;
  measureCellText: (text: string) => number;
  minWidth?: number;
  maxWidth?: number;
  padding?: number;
  sampleLimit?: number;
  defaultWidth: number;
}): number => {
  const safePadding = Math.max(0, Math.ceil(padding));
  let widestTextWidth = Math.max(0, Number(defaultWidth) - safePadding);

  headerTexts.forEach((text) => {
    splitPreviewLines(normalizeAutoFitCellText(text ?? '')).forEach((line) => {
      widestTextWidth = Math.max(widestTextWidth, measureHeaderText(line));
    });
  });

  valueTexts.slice(0, Math.max(1, sampleLimit)).forEach((value) => {
    splitPreviewLines(normalizeAutoFitCellText(value)).forEach((line) => {
      widestTextWidth = Math.max(widestTextWidth, measureCellText(line));
    });
  });

  return clampWidth(widestTextWidth + safePadding, minWidth, maxWidth);
};

export const createDataGridCanvasTextMeasurer = () => {
  let context: CanvasRenderingContext2D | null = null;
  const cache = new Map<string, number>();

  return (text: string, font: string): number => {
    const cacheKey = `${font}\u0000${text}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (!context && typeof document !== 'undefined') {
      context = document.createElement('canvas').getContext('2d');
    }
    if (!context) return text.length * 8;

    context.font = font;
    const width = context.measureText(text).width;
    cache.set(cacheKey, width);
    return width;
  };
};

export const calculateAutoFitColumnWidths = ({
  columnNames,
  rows,
  dataFontSize,
  defaultWidth,
  minWidth,
  maxWidth,
  measureTextWidth = createDataGridCanvasTextMeasurer(),
}: {
  columnNames: string[];
  rows: Array<Record<string, unknown>>;
  dataFontSize: number;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  measureTextWidth?: (text: string, font: string) => number;
}): Record<string, number> => {
  const font = `${dataFontSize}px "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  // Auto-fit runs inside the first render, so its cost is paid before the grid
  // paints. One measureText per (column x sampled row) adds up fast: 100 columns
  // x 200 rows is 20k canvas calls, which visibly delays opening a result set.
  // Spend a fixed budget instead, split across the columns, so wide result sets
  // sample fewer rows per column rather than blocking proportionally longer.
  const perColumnSampleLimit = resolveAutoFitSampleLimit(columnNames.length);
  const sampleRows = perColumnSampleLimit > 0
    ? rows.slice(0, perColumnSampleLimit)
    : [];
  return Object.fromEntries(columnNames.map((columnName) => [
    columnName,
    calculateAutoFitColumnWidth({
      headerTexts: [columnName],
      valueTexts: sampleRows.map((row) => row?.[columnName]),
      measureHeaderText: (text) => measureTextWidth(text, `600 ${font}`),
      measureCellText: (text) => measureTextWidth(text, `400 ${font}`),
      minWidth,
      maxWidth,
      defaultWidth,
    }),
  ]));
};
