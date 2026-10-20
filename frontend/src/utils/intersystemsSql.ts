import { resolveSqlDialect } from './sqlDialectCore';
import { findCteBodyStart, findTopLevelKeyword, getLeadingKeyword, splitSqlTail } from './sqlQueryStructure';

export const isInterSystemsDialect = (dbType: string, driver = ''): boolean => (
  resolveSqlDialect(dbType, driver) === 'iris'
);

const skipTrivia = (sql: string, start: number): number => {
  let pos = start;
  while (pos < sql.length) {
    const trivia = sql.slice(pos).match(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\r\n]*(?:\r?\n|$))/);
    if (!trivia) break;
    pos += trivia[0].length;
  }
  return pos;
};

// TOP belongs to the outer SELECT, not a SELECT inside a CTE or subquery.
// Keep a user's TOP (including TOP ALL) intact rather than silently widening it.
export const addInterSystemsTop = (sql: string, limit: number | 'ALL'): string => {
  const selectPos = findTopLevelKeyword(sql, 'select', 'iris');
  if (selectPos < 0) return sql;
  const compound = ['union', 'intersect', 'except'].some((word) => findTopLevelKeyword(sql, word, 'iris') >= 0);
  if (compound) {
    // TOP on the first UNION branch does not limit the combined result.
    // Caché also rejects the compound ORDER BY inside the derived table.
    const orderPos = findTopLevelKeyword(sql, 'order by', 'iris');
    const end = orderPos < 0 ? sql.length : orderPos;
    const order = orderPos < 0 ? '' : ` ${sql.slice(orderPos)}`;
    return `${sql.slice(0, selectPos)}SELECT TOP ${limit} * FROM (${sql.slice(selectPos, end).trimEnd()}\n) __gonavi_compound__${order}`;
  }
  let insertAt = selectPos + 6;
  const modifierPos = skipTrivia(sql, insertAt);
  const modifier = sql.slice(modifierPos).match(/^(?:DISTINCT|ALL)\b/i);
  if (modifier) insertAt = modifierPos + modifier[0].length;
  const topPos = skipTrivia(sql, insertAt);
  if (/^TOP\b/i.test(sql.slice(topPos))) return sql;
  return `${sql.slice(0, insertAt)} TOP ${limit}${sql.slice(insertAt)}`;
};

const splitCte = (sql: string): { prefix: string; body: string } => {
  const bodyStart = getLeadingKeyword(sql, 'iris') === 'with' ? findCteBodyStart(sql, 'iris') : 0;
  return { prefix: sql.slice(0, bodyStart), body: sql.slice(bodyStart) };
};

// Caché 2016 has neither OFFSET/FETCH nor ROW_NUMBER. %VID numbers the
// materialized TOP subquery AFTER its ORDER BY; it is not part of alias.*.
// Unlike reverse nested TOP, this does not backfill a short or empty last page.
export const buildInterSystemsPaginatedSelectSQL = (
  baseSql: string,
  orderBy: string,
  limit: number,
  offset: number,
): string => {
  const { main, tail } = splitSqlTail(baseSql, 'iris');
  const { prefix, body } = splitCte(main);
  const ordered = `${body}${orderBy}`;
  if (offset <= 0) {
    const limited = addInterSystemsTop(ordered, limit);
    if (limited !== ordered) return `${prefix}${limited}${tail}`;
    // An existing TOP is a result-set boundary, not a pagination cap.
    return `${prefix}SELECT TOP ${limit} __gonavi_page__.* FROM (${ordered}\n) __gonavi_page__ ORDER BY __gonavi_page__.%VID${tail}`;
  }
  const materialized = addInterSystemsTop(ordered, 'ALL');
  return `${prefix}SELECT TOP ${limit} __gonavi_page__.* FROM (${materialized}\n) __gonavi_page__ WHERE __gonavi_page__.%VID > ${offset} AND __gonavi_page__.%VID <= ${offset + limit} ORDER BY __gonavi_page__.%VID${tail}`;
};

export const buildInterSystemsQueryResultCountSql = (baseSql: string): string => {
  const { main } = splitSqlTail(baseSql, 'iris');
  if (!main.trim()) return '';
  const { prefix, body } = splitCte(main);
  const orderPos = findTopLevelKeyword(body, 'order by', 'iris');
  const counted = (orderPos < 0 ? body : body.slice(0, orderPos)).trim();
  return `${prefix}SELECT COUNT(*) AS __gonavi_total__ FROM (${counted}\n) __gonavi_query_count__`;
};

// Retain the user's ORDER BY in the materialized query. A generic SELECT *
// wrapper loses that ordering on Caché. Grid sorting is intentionally outermost
// so it sorts the user's result (including its existing TOP), not its source.
export const buildInterSystemsQueryResultPageSql = (
  baseSql: string,
  orderBy: string,
  limit: number,
  offset: number,
): string => {
  if (!orderBy.trim()) {
    return limit > 0 ? buildInterSystemsPaginatedSelectSQL(baseSql, '', limit, offset) : baseSql.trim();
  }
  const { main, tail } = splitSqlTail(baseSql, 'iris');
  const { prefix, body } = splitCte(main);
  const wrapped = `SELECT * FROM (${addInterSystemsTop(body, 'ALL')}\n) __gonavi_query_page__`;
  const paged = limit > 0
    ? buildInterSystemsPaginatedSelectSQL(wrapped, orderBy, limit, offset)
    : `${wrapped}${orderBy}`;
  return `${prefix}${paged}${tail}`;
};
