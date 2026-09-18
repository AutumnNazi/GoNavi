import {
  findSqlErrorTokenOffset,
  quotedSqlErrorToken,
  tokenOccupiesOffset,
  unescapeSqlErrorToken,
} from './queryEditorErrorToken';

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
): QueryEditorExecutionOrigin => ({
  editorSql: normalizeSqlText(editorSql),
  originalSql: normalizeSqlText(originalSql),
  sentSql: normalizeSqlText(sentSql || originalSql),
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

const resolveFragmentStart = (editorSql: string, originalSql: string): number => {
  if (!originalSql) {
    return 0;
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
  const fragmentStart = resolveFragmentStart(editorSql, originalSql);
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

type QueryEditorErrorLocatorEditor = {
  getModel?: () => {
    getValue?: () => string;
    getPositionAt?: (offset: number) => { lineNumber: number; column: number };
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
