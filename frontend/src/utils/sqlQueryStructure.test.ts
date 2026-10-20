import { describe, expect, it } from 'vitest';
import { findCteBodyStart, findTopLevelKeyword, getLeadingKeyword, splitSqlTail } from './sqlQueryStructure';

describe('SQL query structure shared by automatic caps and pagination', () => {
  it.each(['ORDER BY', 'ORDER\nBY', 'ORDER\t BY', 'ORDER /* sort */ BY', 'ORDER -- sort\nBY'])('recognizes %s without changing offsets', (order) => {
    const sql = `SELECT ID FROM Sample.Person ${order} ID DESC`;
    expect(findTopLevelKeyword(sql, 'order by', 'iris')).toBe(sql.indexOf('ORDER'));
  });

  it.each([
    "SELECT 'ORDER BY' AS label FROM Sample.Person",
    'SELECT "ORDER BY" FROM Sample.Person',
    'SELECT ID FROM (SELECT ID FROM Sample.Person ORDER BY ID) p',
    'SELECT ID FROM Sample.Person /* ORDER BY ID */',
    'SELECT ID FROM Sample.Person --ORDER BY ID',
    'SELECT ID FROM Sample.Person ORDER_BY',
    'SELECT ID FROM Sample.Person ORDER BYPASS',
  ])('ignores nested or non-keyword ordering: %s', (sql) => {
    expect(findTopLevelKeyword(sql, 'order by', 'iris')).toBe(-1);
  });

  it('keeps the MySQL compact double-minus expression distinct from a line comment', () => {
    expect(findTopLevelKeyword('SELECT ID FROM t ORDER --x\nBY ID', 'order by', 'mysql')).toBe(-1);
    expect(findTopLevelKeyword('SELECT ID FROM t ORDER --x\nBY ID', 'order by', 'iris')).toBe(17);
  });

  it('retains CTE boundaries and ignores quoted or nested SELECTs', () => {
    const sql = '-- intro\nWITH p AS (SELECT ID FROM Sample.Person), q AS (SELECT ID FROM p) SELECT ID FROM q';
    expect(getLeadingKeyword(sql, 'iris')).toBe('with');
    expect(findCteBodyStart(sql, 'iris')).toBe(sql.lastIndexOf('SELECT'));
    expect(findTopLevelKeyword(sql, 'select', 'iris')).toBe(sql.lastIndexOf('SELECT'));
  });

  it('separates terminal comments and semicolons without trimming literal content', () => {
    expect(splitSqlTail("SELECT 'end;' AS label; -- tail", 'iris')).toEqual({
      main: "SELECT 'end;' AS label", tail: '; -- tail',
    });
  });
});
