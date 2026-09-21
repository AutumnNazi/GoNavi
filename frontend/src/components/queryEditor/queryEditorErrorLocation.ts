import {
  findSqlErrorTokenOffset,
  quotedSqlErrorToken,
  tokenOccupiesOffset,
  unescapeSqlErrorToken,
} from './queryEditorErrorToken';
import { resolveCurrentSqlStatementRange } from '../../utils/sqlStatementSelection';

export type SqlExecutionErrorLocationKind = 'offset' | 'lineColumn' | 'token';

export type SqlExecutionErrorLocation = {
  kind: SqlExecutionErrorLocationKind;
  offset: number;
  line: number;
  column: number;
  statementIndex: number;
  rawToken: string;
  token?: string;
};

export type QueryEditorExecutionOriginStatement = {
  originalSql?: string;
  executedSql?: string;
};

export type QueryEditorExecutionOrigin = {
  editorSql: string;
  originalSql: string;
  sentSql: string;
  /**
   * 执行时 originalSql 在 editorSql 中的起始偏移（归一化坐标）。
   * 选区执行时由编辑器选区起始位置换算而来，用于把数据库返回的
   * 「片段内相对行号」映射回编辑器绝对位置；缺省时回退 indexOf 首次命中。
   */
  fragmentStartOffset?: number;
  statements?: QueryEditorExecutionOriginStatement[];
};

const OFFSET_PATTERNS = [
  /error occur(?:s|red)? at position:\s*(\d+)/i,
  /(?:error\s+)?at position[:：]\s*(\d+)/i,
  /(?:错误)?位置[:：]\s*(\d+)/,
];

const LINE_COLUMN_PATTERNS = [
  /at line\s+(\d+)\s*,\s*column\s+(\d+)/i,
  /line\s+(\d+)\s*,\s*column\s+(\d+)/i,
  /line\s+(\d+)\s*,\s*position\s+(\d+)/i,
];

const LINE_ONLY_PATTERNS = [
  /^LINE\s+(\d+):/im,
  /\bat line\s+(\d+)\b/i,
];

const STATEMENT_INDEX_PATTERNS = [
  /第\s*(\d+)\s*条/,
  /statement\s+(\d+)\s+failed/i,
];

const NEAR_TOKEN_PATTERNS = [
  /syntax error at or near\s+"((?:\\.|[^"\\])*)"/i,
  /syntax error at or near\s+'((?:\\.|[^'\\])*)'/i,
  /at or near\s+"((?:\\.|[^"\\])*)"/i,
  /at or near\s+'((?:\\.|[^'\\])*)'/i,
  /\bnear\s+"((?:\\.|[^"\\])*)"/i,
  /\bnear\s+'((?:\\.|[^'\\])*)'/i,
];

const normalizeSqlText = (value: unknown): string => String(value || '').replace(/\r\n/g, '\n');

const parsePositiveInt = (value: string | undefined): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const createQueryEditorExecutionOrigin = (
  editorSql: string,
  originalSql: string,
  sentSql = originalSql,
  statements?: QueryEditorExecutionOriginStatement[],
  fragmentStartOffset?: number,
): QueryEditorExecutionOrigin => ({
  editorSql: normalizeSqlText(editorSql),
  originalSql: normalizeSqlText(originalSql),
  sentSql: normalizeSqlText(sentSql || originalSql),
  fragmentStartOffset,
  statements: statements?.map((statement) => ({
    originalSql: normalizeSqlText(statement.originalSql || ''),
    executedSql: normalizeSqlText(statement.executedSql || statement.originalSql || ''),
  })),
});

export const parseSqlExecutionErrorLocation = (
  error: unknown,
): SqlExecutionErrorLocation | null => {
  const text = String(error || '');
  if (!text.trim()) {
    return null;
  }

  let statementIndex = 0;
  for (const pattern of STATEMENT_INDEX_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      statementIndex = parsePositiveInt(match[1]);
      break;
    }
  }

  for (const pattern of OFFSET_PATTERNS) {
    const match = text.match(pattern);
    const offset1 = parsePositiveInt(match?.[1]);
    if (match && offset1 > 0) {
      return {
        kind: 'offset',
        offset: offset1 - 1,
        line: 0,
        column: 0,
        statementIndex,
        rawToken: match[1],
      };
    }
  }

  for (const pattern of LINE_COLUMN_PATTERNS) {
    const match = text.match(pattern);
    const line = parsePositiveInt(match?.[1]);
    const column = parsePositiveInt(match?.[2]);
    if (match && line > 0) {
      return {
        kind: 'lineColumn',
        offset: 0,
        line,
        column: column || 1,
        statementIndex,
        rawToken: match[1],
      };
    }
  }

  for (const pattern of LINE_ONLY_PATTERNS) {
    const match = text.match(pattern);
    const line = parsePositiveInt(match?.[1]);
    if (match && line > 0) {
      return {
        kind: 'lineColumn',
        offset: 0,
        line,
        column: 1,
        statementIndex,
        rawToken: match[1],
      };
    }
  }

  for (const pattern of NEAR_TOKEN_PATTERNS) {
    const match = text.match(pattern);
    const token = unescapeSqlErrorToken(match?.[1]);
    if (match && token) {
      return {
        kind: 'token',
        offset: 0,
        line: 0,
        column: 0,
        statementIndex,
        token,
        rawToken: quotedSqlErrorToken(text, token),
      };
    }
  }

  return null;
};

export const offsetToMonacoPosition = (
  text: string,
  offset: number,
): { lineNumber: number; column: number } => {
  const source = normalizeSqlText(text);
  const safe = Math.max(0, Math.min(source.length, offset));
  const prefix = source.slice(0, safe);
  const lines = prefix.split('\n');
  return {
    lineNumber: Math.max(1, lines.length),
    column: (lines[lines.length - 1]?.length || 0) + 1,
  };
};

const lineColumnToOffset = (
  text: string,
  line: number,
  column: number,
): number => {
  const lines = normalizeSqlText(text).split('\n');
  const lineIndex = Math.min(lines.length, Math.max(1, line)) - 1;
  const lineStart = lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0);
  const maxColumn = (lines[lineIndex]?.length || 0) + 1;
  return lineStart + Math.min(maxColumn, Math.max(1, column)) - 1;
};

const resolveFragmentStart = (
  editorSql: string,
  originalSql: string,
  recordedStart?: number,
): number => {
  if (!originalSql) {
    return 0;
  }
  // 选区执行时 originalSql 在实际选区起点；同一文本在编辑器出现多次时
  // indexOf 只会命中第一处，因此优先采用执行时记录的选区起始偏移，
  // 但仅当片段确实从该偏移开始才信任（编辑器内容可能已变化）。
  if (
    typeof recordedStart === 'number'
    && Number.isInteger(recordedStart)
    && recordedStart > 0
    && recordedStart + originalSql.length <= editorSql.length
    && editorSql.startsWith(originalSql, recordedStart)
  ) {
    return recordedStart;
  }
  const index = editorSql.indexOf(originalSql);
  return index >= 0 ? index : 0;
};

const resolveOriginSqls = (
  location: SqlExecutionErrorLocation,
  origin: QueryEditorExecutionOrigin | null | undefined,
  currentEditorSql: string,
): { editorSql: string; originalSql: string; sentSql: string } => {
  const editorSql = normalizeSqlText(currentEditorSql || origin?.editorSql || '');
  let originalSql = normalizeSqlText(origin?.originalSql || editorSql);
  let sentSql = normalizeSqlText(origin?.sentSql || originalSql);
  const statement = location.statementIndex > 0
    ? origin?.statements?.[location.statementIndex - 1]
    : undefined;
  if (statement?.originalSql) {
    originalSql = statement.originalSql;
    sentSql = statement.executedSql || statement.originalSql;
  }
  return { editorSql, originalSql, sentSql };
};

export const mapSqlErrorLocationToOffset = (
  location: SqlExecutionErrorLocation,
  origin: QueryEditorExecutionOrigin | null | undefined,
  currentEditorSql: string,
): number | null => {
  const { editorSql, originalSql, sentSql } = resolveOriginSqls(location, origin, currentEditorSql);
  if (!editorSql) {
    return null;
  }
  const fragmentStart = resolveFragmentStart(editorSql, originalSql, origin?.fragmentStartOffset);
  const fragment = fragmentStart > 0 || editorSql.startsWith(originalSql)
    ? originalSql
    : editorSql;

  if (location.kind === 'lineColumn') {
    const offsetInFragment = lineColumnToOffset(fragment, location.line, location.column || 1);
    return Math.min(editorSql.length, fragmentStart + offsetInFragment);
  }

  if (location.kind === 'token') {
    const tokenOffset = findSqlErrorTokenOffset(fragment, location.token || '');
    if (tokenOffset == null) {
      return fragmentStart;
    }
    return Math.min(editorSql.length, fragmentStart + tokenOffset);
  }

  let offsetInOriginal = location.offset;
  if (sentSql && sentSql !== originalSql) {
    const inner = sentSql.indexOf(originalSql);
    if (inner >= 0) {
      offsetInOriginal = location.offset - inner;
    }
  }
  const clamped = Math.max(0, Math.min(fragment.length, offsetInOriginal));
  return Math.min(editorSql.length, fragmentStart + clamped);
};

export const splitSqlErrorLocationText = (
  error: string,
  location: SqlExecutionErrorLocation | null,
): Array<{ text: string; locate?: boolean }> => {
  const text = String(error || '');
  const token = String(location?.rawToken || '');
  if (!text || !token) {
    return text ? [{ text }] : [];
  }
  const index = text.lastIndexOf(token);
  if (index < 0) {
    return [{ text }];
  }
  return [
    { text: text.slice(0, index) },
    { text: token, locate: true },
    { text: text.slice(index + token.length) },
  ].filter((part) => part.text);
};

/**
 * 解析执行错误对应的“出错语句”文本，供 AI 诊断注入提示词使用。
 * 优先用错误文本中的语句序号（“第 N 条” / “statement N failed”）取 origin 里
 * 逐条执行的语句——序号独立于位置信息，即使解析不出位置也要先尝试；
 * 否则把错误位置映射回编辑器偏移并取包含该偏移的语句。
 * 解析不出时返回空字符串，由调用方回退为整篇查询。
 */
export const resolveExecutionErrorStatementText = (params: {
  error: string;
  origin?: QueryEditorExecutionOrigin | null;
  currentEditorSql: string;
  dbType?: string;
}): string => {
  const text = String(params.error || '');
  let statementIndex = 0;
  for (const pattern of STATEMENT_INDEX_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      statementIndex = parsePositiveInt(match[1]);
      break;
    }
  }
  const statement = statementIndex > 0
    ? params.origin?.statements?.[statementIndex - 1]
    : undefined;
  if (statement?.originalSql?.trim()) {
    return statement.originalSql.trim();
  }
  const location = parseSqlExecutionErrorLocation(params.error);
  if (!location) {
    return '';
  }
  const editorSql = normalizeSqlText(params.currentEditorSql || params.origin?.editorSql || '');
  if (!editorSql) {
    return '';
  }
  const offset = mapSqlErrorLocationToOffset(location, params.origin, editorSql);
  if (offset == null) {
    return '';
  }
  const range = resolveCurrentSqlStatementRange(editorSql, offset, params.dbType || '');
  return range?.text?.trim() || '';
};

type QueryEditorErrorLocatorEditor = {
  getModel?: () => {
    getValue?: () => string;
    getPositionAt?: (offset: number) => { lineNumber: number; column: number };
    getOffsetAt?: (position: { lineNumber: number; column: number }) => number;
  } | null;
  getSelection?: () => {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  setPosition?: (position: { lineNumber: number; column: number }) => void;
  setSelection?: (selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) => void;
  revealPositionInCenterIfOutsideViewport?: (position: { lineNumber: number; column: number }) => void;
  revealLineInCenterIfOutsideViewport?: (lineNumber: number) => void;
  focus?: () => void;
} | null | undefined;

/**
 * 读取编辑器当前选区起始位置，换算成 origin 使用的归一化偏移。
 *
 * 执行时调用：把 Monaco 选区的原始偏移映射到 \r\n → \n 归一化后的坐标系，
 * 使 lineColumn 类数据库错误能按「选区起始 + 片段内相对行」映射回编辑器。
 * 编辑器取值与传入的 editorSql 不一致（内容已变化）时返回 undefined，
 * 由 mapSqlErrorLocationToOffset 回退到 indexOf 首次命中。
 */
export const resolveEditorSelectionStartOffset = (
  editor: QueryEditorErrorLocatorEditor | null | undefined,
  editorSql: string,
): number | undefined => {
  const model = editor?.getModel?.();
  const selection = editor?.getSelection?.();
  if (!model || !selection) {
    return undefined;
  }
  const rawValue = model.getValue?.();
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  if (normalizeSqlText(rawValue) !== normalizeSqlText(editorSql)) {
    return undefined;
  }
  const rawOffset = model.getOffsetAt?.({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });
  if (typeof rawOffset !== 'number' || !Number.isFinite(rawOffset) || rawOffset < 0) {
    return undefined;
  }
  return normalizeSqlText(rawValue.slice(0, rawOffset)).length;
};

export const revealQueryEditorSqlErrorLocation = (params: {
  editor: QueryEditorErrorLocatorEditor;
  error: string;
  origin?: QueryEditorExecutionOrigin | null;
  currentSql?: string;
}): boolean => {
  const location = parseSqlExecutionErrorLocation(params.error);
  if (!location) {
    return false;
  }
  const editor = params.editor;
  const model = editor?.getModel?.() || null;
  const currentSql = String(params.currentSql || model?.getValue?.() || '');
  const offset = mapSqlErrorLocationToOffset(location, params.origin, currentSql);
  if (offset == null) {
    return false;
  }
  const position = model?.getPositionAt?.(offset) || offsetToMonacoPosition(currentSql, offset);
  if (!position?.lineNumber) {
    return false;
  }
  editor?.setPosition?.(position);
  const highlightLength = location.kind === 'token' && tokenOccupiesOffset(currentSql, offset, location.token || '')
    ? Math.max(1, (location.token || '').length)
    : 1;
  editor?.setSelection?.({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column + highlightLength,
  });
  if (editor?.revealPositionInCenterIfOutsideViewport) {
    editor.revealPositionInCenterIfOutsideViewport(position);
  } else {
    editor?.revealLineInCenterIfOutsideViewport?.(position.lineNumber);
  }
  editor?.focus?.();
  return true;
};
