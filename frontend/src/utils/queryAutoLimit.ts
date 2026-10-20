import { resolveSqlDialect } from './sqlDialect';
import { buildPaginatedSelectSQL, splitTrailingIsolationClause } from './sql';
import { addInterSystemsTop } from './intersystemsSql';
import { findCteBodyStart, findTopLevelKeyword, getLeadingKeyword, splitSqlTail } from './sqlQueryStructure';
import { getDataSourceSpec } from './dataSourceRegistry';
import { buildRegistryPaginatedSelectSQL } from './dataSourceRegistry/sqlBehavior';
export { findTopLevelKeyword, getLeadingKeyword, splitSqlTail } from './sqlQueryStructure';

const isWS = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);

const hasOracleSequencePseudoColumn = (sql: string): boolean => {
  const text = sql || '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-') {
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (!inDouble && !inBacktick && ch === "'") {
      if (inSingle && next === "'") {
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      if (inDouble && next === '"') {
        i++;
      } else {
        inDouble = !inDouble;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingle || inDouble || inBacktick || ch !== '.') continue;

    let tokenStart = i + 1;
    while (tokenStart < text.length && isWS(text[tokenStart])) tokenStart++;
    let tokenEnd = tokenStart;
    while (tokenEnd < text.length && isWord(text[tokenEnd])) tokenEnd++;
    const token = text.slice(tokenStart, tokenEnd).toLowerCase();
    if (token === 'nextval' || token === 'currval') return true;
  }

  return false;
};

// limitOracleCteMainQuery 只限制 CTE 的主查询。
// Oracle 12c 之前不认识 FETCH FIRST，直接追加会得到 ORA-00933。
// 把整个 WITH 塞进 ROWNUM 内联视图也不行：子查询因子化必须留在查询块最外层。
const limitOracleCteMainQuery = (executableMain: string, dbType: string, maxRows: number): string | null => {
  if (getLeadingKeyword(executableMain, dbType) !== 'with') return null;
  const bodyStart = findCteBodyStart(executableMain, dbType);
  if (bodyStart <= 0) return null;
  const mainQuery = executableMain.slice(bodyStart).trim();
  if (!mainQuery || hasOracleSequencePseudoColumn(mainQuery)) return null;
  return `${executableMain.slice(0, bodyStart)}SELECT * FROM (${mainQuery}) WHERE ROWNUM <= ${maxRows}`;
};

/**
 * 语句是否以 SELECT 结果集收尾 —— CTE 语句看其主查询，而不是 literal 的
 * leading keyword。`getLeadingKeyword(x) === 'select'` 会把 `WITH ... SELECT`
 * 判成非查询，导致这类语句拿不到行数上限、分页状态或导出路径。
 *
 * 只放行 SELECT 主体：`WITH ... INSERT/UPDATE/DELETE` 返回 false。
 */
export const isSelectStatement = (sql: string, dbType = ''): boolean => {
  const text = String(sql || '');
  if (!text.trim()) return false;
  const keyword = getLeadingKeyword(text, dbType);
  if (keyword === 'select') return true;
  if (keyword !== 'with') return false;
  const bodyStart = findCteBodyStart(text, dbType);
  if (bodyStart <= 0) return false;
  return getLeadingKeyword(text.slice(bodyStart), dbType) === 'select';
};

export const applyQueryAutoLimit = (
  sql: string,
  dbType: string,
  maxRows: number,
  driver = '',
): { sql: string; applied: boolean; maxRows: number } => {
  if (!Number.isFinite(maxRows) || maxRows <= 0) return { sql, applied: false, maxRows };
  const normalizedType = String(resolveSqlDialect(dbType || 'mysql', driver)).toLowerCase();
  // CTE 语句的 leading keyword 是 `with`，但行数上限真正作用在其后的主查询上。
  // 这里只放行 SELECT 主体：`WITH ... INSERT/UPDATE/DELETE` 注入 LIMIT 会破坏语法，
  // `WITH ... VALUES (...)` 也没有可追加 LIMIT 的位置，一律保持原样。
  const cteBodyStart = getLeadingKeyword(sql, normalizedType) === 'with'
    ? findCteBodyStart(sql, normalizedType)
    : 0;
  if (!isSelectStatement(sql, normalizedType)) return { sql, applied: false, maxRows };

  const { main, tail } = splitSqlTail(sql, normalizedType);
  if (!main.trim()) return { sql, applied: false, maxRows };
  const isolationStatement = normalizedType === 'dameng'
    ? splitTrailingIsolationClause(main)
    : { main, tail: '' };
  const executableMain = isolationStatement.main;
  const executableSql = `${executableMain}${isolationStatement.tail}${tail}`;

  const fromPos = findTopLevelKeyword(executableMain, 'from', normalizedType);
  const limitPos = findTopLevelKeyword(executableMain, 'limit', normalizedType);
  if (limitPos >= 0 && (fromPos < 0 || limitPos > fromPos)) return { sql: executableSql, applied: false, maxRows };
  const fetchPos = findTopLevelKeyword(executableMain, 'fetch', normalizedType);
  if (fetchPos >= 0 && (fromPos < 0 || fetchPos > fromPos)) return { sql: executableSql, applied: false, maxRows };

  if (normalizedType === 'iris') {
    const limited = addInterSystemsTop(executableMain, Math.floor(maxRows));
    return { sql: limited + tail, applied: limited !== executableMain, maxRows };
  }

  if (normalizedType === 'sqlserver' || normalizedType === 'mssql') {
    const topPos = findTopLevelKeyword(executableMain, 'top', normalizedType);
    if (topPos >= 0) return { sql, applied: false, maxRows };
    const selectPos = findTopLevelKeyword(executableMain, 'select', normalizedType);
    if (selectPos < 0) return { sql, applied: false, maxRows };
    const afterSelect = selectPos + 'SELECT'.length;
    const restAfterSelect = executableMain.slice(afterSelect);
    const distinctMatch = restAfterSelect.match(/^(\s+DISTINCT\b)/i);
    const insertOffset = distinctMatch ? afterSelect + distinctMatch[1].length : afterSelect;
    const nextMain = executableMain.slice(0, insertOffset) + ` TOP ${maxRows}` + executableMain.slice(insertOffset);
    return { sql: nextMain + tail, applied: true, maxRows };
  }

  if (normalizedType === 'oracle' || normalizedType === 'dameng') {
    const rownumPos = findTopLevelKeyword(executableMain, 'rownum', normalizedType);
    if (rownumPos >= 0) return { sql: executableSql, applied: false, maxRows };
    const existingFetchPos = findTopLevelKeyword(executableMain, 'fetch', normalizedType);
    if (existingFetchPos >= 0 && (fromPos < 0 || existingFetchPos > fromPos)) {
      return { sql: executableSql, applied: false, maxRows };
    }
    const offsetPos = findTopLevelKeyword(executableMain, 'offset', normalizedType);
    if (offsetPos >= 0 && (fromPos < 0 || offsetPos > fromPos)) return { sql: executableSql, applied: false, maxRows };
    const forPos = findTopLevelKeyword(executableMain, 'for', normalizedType);
    if (forPos >= 0 && (fromPos < 0 || forPos > fromPos)) return { sql: executableSql, applied: false, maxRows };
    if (normalizedType === 'oracle' && cteBodyStart > 0) {
      const limitedCte = limitOracleCteMainQuery(executableMain, normalizedType, maxRows);
      if (!limitedCte) return { sql: executableSql, applied: false, maxRows };
      return { sql: `${limitedCte}${tail}`, applied: true, maxRows };
    }
    // Oracle-compatible databases reject NEXTVAL/CURRVAL when the ROWNUM cap
    // moves the original SELECT into a subquery.
    if (hasOracleSequencePseudoColumn(executableMain)) return { sql: executableSql, applied: false, maxRows };
    return { sql: `${buildPaginatedSelectSQL(normalizedType, main, '', maxRows, 0)}${tail}`, applied: true, maxRows };
  }

  // 描述表声明了非 LIMIT 分页语法的数据源（Firebird 的 ROWS m TO n、GBase 8s 的 SKIP / FIRST）不能追加 LIMIT。
  const registryPagination = getDataSourceSpec(dbType)?.ui?.pagination;
  if (registryPagination === 'rows-to' || registryPagination === 'skip-first') {
    const ownLimit = ['rows', 'first', 'skip'].some((keyword) => findTopLevelKeyword(executableMain, keyword, normalizedType) >= 0);
    const limited = ownLimit || (registryPagination === 'skip-first' && cteBodyStart > 0)
      ? undefined
      : buildRegistryPaginatedSelectSQL(dbType, executableMain, '', maxRows, 0);
    return limited
      ? { sql: `${limited}${isolationStatement.tail}${tail}`, applied: true, maxRows }
      : { sql: executableSql, applied: false, maxRows };
  }

  const offsetPos = findTopLevelKeyword(executableMain, 'offset', normalizedType);
  const forPos = findTopLevelKeyword(executableMain, 'for', normalizedType);
  const lockPos = findTopLevelKeyword(executableMain, 'lock', normalizedType);
  const candidates = [offsetPos, forPos, lockPos]
    .filter(pos => pos >= 0 && (fromPos < 0 || pos > fromPos));
  const insertAt = candidates.length > 0 ? Math.min(...candidates) : executableMain.length;
  const before = executableMain.slice(0, insertAt).trimEnd();
  const after = executableMain.slice(insertAt).trimStart();
  const nextMain = [before, `LIMIT ${maxRows}`, after].filter(Boolean).join(' ').trim();
  return { sql: nextMain + tail, applied: true, maxRows };
};
