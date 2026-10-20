import type { SqlStatementRange } from './sqlStatementSelection';

// MySQL 客户端的 DELIMITER 不是服务端语法：mysql 命令行、Navicat 用它临时更换语句结束符，
// 好让 CREATE PROCEDURE 里的分号不被当成语句边界。服务端收到 DELIMITER 行会报 1064。
// 识别规则与后端 internal/app/sql_split_stream.go 的客户端指令扫描保持一致：
// 只在 mysql / mariadb 方言下识别，指令必须独占一行，且出现在语句开头（之前只有注释）。

const MYSQL_CLIENT_DELIMITER_DIALECTS = new Set(['mysql', 'mariadb']);

const DELIMITER_DIRECTIVE_LINE = /^delimiter[ \t\r\f]+(\S+)[ \t\r\f]*$/i;

export const isMysqlClientDelimiterDialect = (dbType: string): boolean => (
  MYSQL_CLIENT_DELIMITER_DIALECTS.has(String(dbType || '').trim().toLowerCase())
);

// WHILE / REPEAT do not increase BEGIN depth, so their END must not decrease it.
export const isSqlControlEndKeyword = (keyword: string, dbType: string): boolean => (
  ['if', 'loop', 'case'].includes(keyword)
  || (isMysqlClientDelimiterDialect(dbType) && (keyword === 'while' || keyword === 'repeat'))
);

const isHorizontalWhitespace = (ch: string): boolean => (
  ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f'
);

const isLineStart = (text: string, index: number): boolean => {
  for (let pos = index - 1; pos >= 0; pos--) {
    if (!isHorizontalWhitespace(text[pos])) {
      return text[pos] === '\n';
    }
  }
  return true;
};

const resolveDelimiterDirective = (text: string, index: number): { delimiter: string; lineEnd: number } | null => {
  const newline = text.indexOf('\n', index);
  const lineEnd = newline < 0 ? text.length : newline + 1;
  const match = text.slice(index, newline < 0 ? text.length : newline).match(DELIMITER_DIRECTIVE_LINE);
  return match ? { delimiter: match[1], lineEnd } : null;
};

/**
 * Fast dialect-aware prefilter for standalone DELIMITER lines. The scanner
 * still verifies their SQL lexical context before consuming client directives.
 */
export const textHasMysqlDelimiterDirective = (dbType: string, sql: string): boolean => {
  if (!isMysqlClientDelimiterDialect(dbType)) return false;
  return String(sql || '').split('\n').some((line) => DELIMITER_DIRECTIVE_LINE.test(line.replace(/^[ \t\r\f]+/, '')));
};

/**
 * Splits a MySQL script that uses DELIMITER directives. Directive lines are
 * not part of any statement, and semicolons between custom delimiters stay
 * inside the statement. trimRange decides whether a slice is executable.
 * Returns null if every apparent directive was inside SQL or a comment, so
 * callers can keep using the regular splitter for scripts without directives.
 */
export const findMysqlDelimiterStatementRanges = (
  text: string,
  trimRange: (start: number, end: number) => SqlStatementRange | null,
): SqlStatementRange[] | null => {
  const ranges: SqlStatementRange[] = [];
  let hasDirective = false;
  let delimiter = ';';
  let statementStart = 0;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;

  const push = (end: number) => {
    const range = trimRange(statementStart, end);
    if (range) ranges.push(range);
  };

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const next = index + 1 < text.length ? text[index + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\' && quote !== '`') {
        index++;
        continue;
      }
      if (ch === quote) {
        if (next === quote) {
          index++;
          continue;
        }
        quote = '';
      }
      continue;
    }

    if ((ch === 'd' || ch === 'D') && isLineStart(text, index) && !trimRange(statementStart, index)) {
      const directive = resolveDelimiterDirective(text, index);
      if (directive) {
        hasDirective = true;
        delimiter = directive.delimiter;
        statementStart = directive.lineEnd;
        index = directive.lineEnd - 1;
        continue;
      }
    }

    if (delimiter !== ';' && text.startsWith(delimiter, index)) {
      push(index);
      statementStart = index + delimiter.length;
      index += delimiter.length - 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '#' || (ch === '-' && next === '-' && (index + 2 >= text.length || /\s/.test(text[index + 2])))) {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }
    if (delimiter === ';' && (ch === ';' || ch === '；')) {
      push(index);
      statementStart = index + 1;
    }
  }

  push(text.length);
  return hasDirective ? ranges : null;
};
