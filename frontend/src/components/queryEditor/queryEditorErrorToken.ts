const IDENT_RE = /^[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*$/;
const CLAUSE_TOKEN_RE = /^(select|from|where|group|order|having|limit|offset|union|except|intersect|join|inner|left|right|full|cross|on|and|or|when|then|else|end|returning|into|values|set|with|window|qualify|fetch|over|partition|using|as|by|case)$/i;
const CLAUSE_AFTER_TRAILING_COMMA_RE = /^(from|where|group|order|having|limit|offset|union|except|intersect|join|inner|left|right|full|cross|window|qualify|fetch|returning)$/i;
const PREV_LINE_CLAUSE_TAIL_RE = /\b(?:select|from|where|and|or|on|join|by|when|then|else|as|set|values|into|case)\s*$/i;

const collectSubstringOffsets = (source: string, token: string): number[] => {
  if (!source || !token) {
    return [];
  }
  const offsets: number[] = [];
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(token, from);
    if (index < 0) {
      break;
    }
    offsets.push(index);
    from = index + Math.max(token.length, 1);
  }
  return offsets;
};

const lastNonWhitespaceOffsetBefore = (sql: string, exclusiveEnd: number): number => {
  let caret = Math.max(0, exclusiveEnd);
  while (caret > 0 && /\s/.test(sql[caret - 1] || '')) {
    caret -= 1;
  }
  return Math.max(0, caret - 1);
};

const looksLikeSelectListExpressionTail = (remainder: string): boolean => {
  if (!remainder) {
    return true;
  }
  return /^[(.]/.test(remainder) || /^(as|over|from)\b/i.test(remainder);
};

const looksLikeNewSelectListItem = (
  token: string,
  linePrefix: string,
  lineRemainder: string,
): boolean => {
  if (token === '(') {
    return !linePrefix || IDENT_RE.test(linePrefix);
  }
  if (linePrefix || !IDENT_RE.test(token) || CLAUSE_TOKEN_RE.test(token)) {
    return false;
  }
  // FROM1 lab_customers is a mistyped FROM clause, not another select-list expression.
  return looksLikeSelectListExpressionTail(lineRemainder);
};

const isUnfinishedSelectListLine = (prevLine: string): boolean => {
  if (!prevLine || /[,(;]$/.test(prevLine)) {
    return false;
  }
  return !PREV_LINE_CLAUSE_TAIL_RE.test(prevLine);
};

const preferTrailingCommaBeforeClauseOffset = (
  sql: string,
  matches: number[],
  token: string,
): number | null => {
  if (!CLAUSE_AFTER_TRAILING_COMMA_RE.test(token)) {
    return null;
  }
  for (const index of matches) {
    const offset = lastNonWhitespaceOffsetBefore(sql, index);
    if (sql[offset] === ',') {
      return offset;
    }
  }
  return null;
};

const preferMissingSelectListCommaOffset = (
  sql: string,
  matches: number[],
  token: string,
): number | null => {
  for (const index of matches) {
    const before = sql.slice(0, index);
    const lineStart = before.lastIndexOf('\n') + 1;
    const linePrefix = before.slice(lineStart).trim();
    const lineRemainder = sql.slice(index + token.length).split('\n')[0].trim();
    if (!looksLikeNewSelectListItem(token, linePrefix, lineRemainder)) {
      continue;
    }
    const prevNewline = before.lastIndexOf('\n');
    if (prevNewline < 0) {
      continue;
    }
    const prevLine = (before.slice(0, prevNewline).split('\n').pop() || '').trim();
    if (!isUnfinishedSelectListLine(prevLine)) {
      continue;
    }
    // Parser reports the next item; the missing comma sits on the previous select list item.
    return lastNonWhitespaceOffsetBefore(sql, prevNewline);
  }
  return null;
};

const preferSelectListCommaFixOffset = (
  sql: string,
  matches: number[],
  token: string,
): number | null => (
  preferTrailingCommaBeforeClauseOffset(sql, matches, token)
    ?? preferMissingSelectListCommaOffset(sql, matches, token)
);

export const unescapeSqlErrorToken = (value: string | undefined): string => {
  const token = String(value || '');
  if (!token) {
    return '';
  }
  return token.replace(/\\([\\'"nrt])/g, (_full, escaped: string) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    return escaped;
  });
};

export const quotedSqlErrorToken = (error: string, token: string): string => {
  const doubleQuoted = `"${token}"`;
  if (error.includes(doubleQuoted)) {
    return doubleQuoted;
  }
  const singleQuoted = `'${token}'`;
  if (error.includes(singleQuoted)) {
    return singleQuoted;
  }
  return token;
};

export const tokenOccupiesOffset = (sql: string, offset: number, token: string): boolean => {
  if (!token) {
    return false;
  }
  const actual = String(sql || '').slice(offset, offset + token.length);
  return actual.toLowerCase() === token.toLowerCase();
};

export const findSqlErrorTokenOffset = (sql: string, token: string): number | null => {
  const source = String(sql || '').replace(/\r\n/g, '\n');
  const needle = String(token || '');
  if (!source || !needle) {
    return null;
  }
  const exact = collectSubstringOffsets(source, needle);
  if (exact.length > 0) {
    return preferSelectListCommaFixOffset(source, exact, needle) ?? exact[0];
  }
  if (needle.length === 1) {
    return null;
  }
  const index = source.toLowerCase().indexOf(needle.toLowerCase());
  return index >= 0 ? index : null;
};
