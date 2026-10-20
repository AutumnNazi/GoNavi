export interface DataGridClipboardPayload {
  plainText: string;
  html?: string;
  csv?: string;
  markdown?: string;
  json?: string;
}

export type DataGridClipboardCell = string | null;

export const DATA_GRID_IN_APP_HTML_ATTR = 'data-gonavi-clipboard';
export const DATA_GRID_IN_APP_NULL_ATTR = 'data-gonavi-null';
export const DATA_GRID_IN_APP_JSON_MARKER = 'gonaviGrid';

export interface BuildTabularClipboardPayloadInput {
  columns?: string[];
  rows: DataGridClipboardCell[][];
  jsonRows?: Array<Record<string, unknown>>;
  preserveCellTypes?: boolean;
}

type ClipboardWriter = Partial<Pick<Clipboard, 'write' | 'writeText'>>;

type ClipboardDataWriter = Pick<DataTransfer, 'clearData' | 'setData'>;

export interface ClipboardEventLike {
  clipboardData?: ClipboardDataWriter | null;
  preventDefault?: () => void;
}

export const buildDataGridInAppClipboardJson = (values: DataGridClipboardCell[][]): string => (
  JSON.stringify({ [DATA_GRID_IN_APP_JSON_MARKER]: 1, values })
);

const normalizeClipboardMatrixCell = (value: unknown, nullToken = ''): string => (
  value === null || value === undefined ? nullToken : String(value)
);

const formatPlainTextMatrixCell = (value: unknown, preserveCellTypes: boolean): string => {
  if (value === null || value === undefined) {
    return preserveCellTypes ? 'NULL' : '';
  }
  const text = String(value).replace(/\r\n/g, '\n').replace(/[\t\n\r]+/g, ' ');
  if (preserveCellTypes && (text === 'NULL' || text.startsWith('"'))) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const escapeHtml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

const escapeCsvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const renderHtmlCell = (cell: unknown, preserveCellTypes: boolean, tag: 'td' | 'th'): string => {
  if (preserveCellTypes && (cell === null || cell === undefined)) {
    return `<${tag} ${DATA_GRID_IN_APP_NULL_ATTR}="true">NULL</${tag}>`;
  }
  return `<${tag}>${escapeHtml(normalizeClipboardMatrixCell(cell))}</${tag}>`;
};

const buildDelimitedText = (
  rows: DataGridClipboardCell[][],
  delimiter: string,
  columns?: string[],
  preserveCellTypes = false,
): string => {
  const matrix = columns ? [columns, ...rows] : rows;
  return matrix.map((row) => row.map((cell) => formatPlainTextMatrixCell(cell, preserveCellTypes)).join(delimiter)).join('\n');
};

const buildCsvText = (
  rows: DataGridClipboardCell[][],
  columns?: string[],
  preserveCellTypes = false,
): string => {
  const nullToken = preserveCellTypes ? 'NULL' : '';
  const matrix = columns ? [columns, ...rows] : rows;
  return matrix.map((row) => row.map((cell) => escapeCsvCell(normalizeClipboardMatrixCell(cell, nullToken))).join(',')).join('\n');
};

const buildHtmlTable = (
  rows: DataGridClipboardCell[][],
  columns?: string[],
  preserveCellTypes = false,
): string => {
  const tableAttr = preserveCellTypes ? ` ${DATA_GRID_IN_APP_HTML_ATTR}="true"` : '';
  const header = columns && columns.length > 0
    ? `<thead><tr>${columns.map((column) => renderHtmlCell(column, false, 'th')).join('')}</tr></thead>`
    : '';
  const body = rows.map((row) => (
    `<tr>${row.map((cell) => renderHtmlCell(cell, preserveCellTypes, 'td')).join('')}</tr>`
  )).join('');
  return `<meta charset="utf-8"><table${tableAttr}>${header}<tbody>${body}</tbody></table>`;
};

const buildMarkdownText = (
  rows: DataGridClipboardCell[][],
  columns?: string[],
  preserveCellTypes = false,
): string => {
  if (!columns || columns.length === 0) return '';
  const nullToken = preserveCellTypes ? 'NULL' : '';
  const escapeMarkdownCell = (value: unknown): string => (
    normalizeClipboardMatrixCell(value, nullToken)
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
  );
  const header = `| ${columns.map(escapeMarkdownCell).join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const lines = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`);
  return [header, separator, ...lines].join('\n');
};

export const buildTabularClipboardPayload = ({
  columns,
  rows,
  jsonRows,
  preserveCellTypes = false,
}: BuildTabularClipboardPayloadInput): DataGridClipboardPayload => ({
  plainText: buildDelimitedText(rows, '\t', columns, preserveCellTypes),
  html: buildHtmlTable(rows, columns, preserveCellTypes),
  csv: buildCsvText(rows, columns, preserveCellTypes),
  markdown: buildMarkdownText(rows, columns, preserveCellTypes) || undefined,
  json: jsonRows
    ? JSON.stringify(jsonRows, null, 2)
    : (preserveCellTypes ? buildDataGridInAppClipboardJson(rows) : undefined),
});

export const buildTabularClipboardPayloadFromTsv = (
  text: string,
  options: { firstRowIsHeader?: boolean } = {},
): DataGridClipboardPayload => {
  const matrix = text.split('\n').map((line) => line.split('\t'));
  const columns = options.firstRowIsHeader ? matrix[0] : undefined;
  const rows = options.firstRowIsHeader ? matrix.slice(1) : matrix;
  return {
    ...buildTabularClipboardPayload({ columns, rows }),
    plainText: text,
  };
};

export const writeClipboardPayloadToEvent = (
  event: ClipboardEventLike,
  payload: DataGridClipboardPayload,
): boolean => {
  const clipboardData = event.clipboardData;
  if (!clipboardData || !payload.plainText) return false;

  clipboardData.clearData();
  clipboardData.setData('text/plain', payload.plainText);
  if (payload.html) clipboardData.setData('text/html', payload.html);
  if (payload.csv) clipboardData.setData('text/csv', payload.csv);
  if (payload.markdown) clipboardData.setData('text/markdown', payload.markdown);
  if (payload.json) clipboardData.setData('application/json', payload.json);
  event.preventDefault?.();
  return true;
};

const appendClipboardItemPart = (
  parts: Record<string, Blob>,
  type: string,
  value: string | undefined,
  supportsType?: (type: string) => boolean,
) => {
  if (!value) return;
  if (type !== 'text/plain') {
    if (supportsType && !supportsType(type)) return;
    if (!supportsType && type !== 'text/html') return;
  }
  parts[type] = new Blob([value], { type });
};

export const writeClipboardPayload = async (
  payload: DataGridClipboardPayload,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<void> => {
  if (!payload.plainText) return;

  const ClipboardItemConstructor = typeof ClipboardItem === 'undefined' ? null : ClipboardItem;
  if (clipboard?.write && ClipboardItemConstructor) {
    const supportsType = typeof ClipboardItemConstructor.supports === 'function'
      ? ClipboardItemConstructor.supports.bind(ClipboardItemConstructor)
      : undefined;
    const parts: Record<string, Blob> = {};
    appendClipboardItemPart(parts, 'text/plain', payload.plainText, supportsType);
    appendClipboardItemPart(parts, 'text/html', payload.html, supportsType);
    appendClipboardItemPart(parts, 'text/csv', payload.csv, supportsType);
    appendClipboardItemPart(parts, 'text/markdown', payload.markdown, supportsType);
    appendClipboardItemPart(parts, 'application/json', payload.json, supportsType);

    try {
      await clipboard.write([new ClipboardItemConstructor(parts)]);
      return;
    } catch {
      // Fall back to writeText below when WebView support is partial.
    }
  }

  let writeError: unknown = new Error('Clipboard write is not supported');
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(payload.plainText);
      return;
    } catch (error) {
      writeError = error;
    }
  }

  const runtime = (globalThis as typeof globalThis & {
    window?: { runtime?: { ClipboardSetText?: (text: string) => Promise<boolean> } };
  }).window?.runtime;
  if (typeof runtime?.ClipboardSetText === 'function') {
    if (await runtime.ClipboardSetText(payload.plainText) === true) return;
    throw new Error('Native clipboard write failed');
  }

  throw writeError;
};
