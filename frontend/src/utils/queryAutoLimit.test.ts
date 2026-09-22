import { describe, expect, it } from 'vitest';

import { applyQueryAutoLimit } from './queryAutoLimit';

describe('applyQueryAutoLimit', () => {
  const limitDialects = [
    'mysql',
    'goldendb',
    'mariadb',
    'oceanbase',
    'diros',
    'doris',
    'starrocks',
    'sphinx',
    'postgres',
    'postgresql',
    'kingbase',
    'kingbase8',
    'highgo',
    'vastbase',
    'opengauss',
    'gaussdb',
    'iris',
    'intersystemsiris',
    'sqlite',
    'sqlite3',
    'duckdb',
    'clickhouse',
    'tdengine',
    'iotdb',
  ];

  it.each(limitDialects)('adds generic LIMIT for %s connections', (dbType) => {
    expect(applyQueryAutoLimit('SELECT * FROM users', dbType, 500).sql)
      .toBe('SELECT * FROM users LIMIT 500');
  });

  it.each([
    ['oracle'],
  ])('adds ROWNUM limit for %s connections', (dbType) => {
    expect(applyQueryAutoLimit('SELECT * FROM MYCIMLED.EDC_LOG', dbType, 500).sql)
      .toBe('SELECT * FROM (SELECT * FROM MYCIMLED.EDC_LOG) WHERE ROWNUM <= 500');
  });

  it.each([
    ['dameng'],
    ['dm'],
    ['dm8'],
  ])('uses native LIMIT for %s connections without a derived-table wrapper', (dbType) => {
    const sql = 'SELECT t.ID, v.ID FROM VULNERABILITY_INFO_T t INNER JOIN VULNERABILITY_DETAIL_T v ON t.CODE = v.VULN_DETAIL';

    expect(applyQueryAutoLimit(sql, dbType, 5000)).toEqual({
      sql: `${sql} LIMIT 5000 OFFSET 0`,
      applied: true,
      maxRows: 5000,
    });
  });

  it('places the Dameng limit before a trailing WITH UR clause', () => {
    const sql = `SELECT DISTINCT
  v.emp_id,
  v.emp_name,
  s.stru_order
FROM pub_stru s, pub_emp_view_all v
WHERE s.organ_id = v.emp_id
  AND v.emp_id IN (
    SELECT b.organ_id
    FROM pub_organ_view a, pub_organ_role b
    WHERE locate(',' || a.organ_id || ',', ',' || b.range_ids || ',') > 0
  )
ORDER BY s.stru_order WITH ur;`;

    for (const [dbType, driver] of [['dameng', ''], ['custom', 'dm8']]) {
      expect(applyQueryAutoLimit(sql, dbType, 500, driver)).toEqual({
        sql: sql.replace(' WITH ur;', ' LIMIT 500 OFFSET 0 WITH ur;'),
        applied: true,
        maxRows: 500,
      });
    }
  });

  it.each([
    ['sqlserver'],
    ['mssql'],
    ['sql_server'],
    ['sql-server'],
  ])('adds TOP limit for %s connections', (dbType) => {
    expect(applyQueryAutoLimit('SELECT * FROM users', dbType, 500).sql)
      .toBe('SELECT TOP 500 * FROM users');
  });

  it('adds SQL Server TOP after DISTINCT', () => {
    expect(applyQueryAutoLimit('SELECT DISTINCT name FROM users', 'sqlserver', 500).sql)
      .toBe('SELECT DISTINCT TOP 500 name FROM users');
  });

  it.each([
    ['oracle', 'SELECT * FROM (SELECT * FROM users) WHERE ROWNUM <= 500'],
    ['dm8', 'SELECT * FROM users LIMIT 500 OFFSET 0'],
    ['mssql', 'SELECT TOP 500 * FROM users'],
    ['postgresql', 'SELECT * FROM users LIMIT 500'],
    ['gauss-db', 'SELECT * FROM users LIMIT 500'],
    ['doris', 'SELECT * FROM users LIMIT 500'],
    ['starrocks', 'SELECT * FROM users LIMIT 500'],
    ['sqlite3', 'SELECT * FROM users LIMIT 500'],
  ])('uses custom driver dialect %s', (driver, expected) => {
    expect(applyQueryAutoLimit('SELECT * FROM users', 'custom', 500, driver).sql)
      .toBe(expected);
  });

  it('keeps trailing semicolon and comments after injected Oracle ROWNUM limit', () => {
    expect(applyQueryAutoLimit('SELECT * FROM MYCIMLED.EDC_LOG; -- preview', 'oracle', 500).sql)
      .toBe('SELECT * FROM (SELECT * FROM MYCIMLED.EDC_LOG) WHERE ROWNUM <= 500; -- preview');
  });

  it('uses Oracle ROWNUM limit for simple table queries', () => {
    expect(applyQueryAutoLimit('select 1 from xxx', 'oracle', 500).sql)
      .toBe('SELECT * FROM (select 1 from xxx) WHERE ROWNUM <= 500');
  });

  it('keeps ORDER BY semantics with Oracle ROWNUM wrapping', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users ORDER BY created_at DESC', 'oracle', 100).sql)
      .toBe('SELECT * FROM (SELECT * FROM users ORDER BY created_at DESC) WHERE ROWNUM <= 100');
  });

  it('does not add another generic limit when SQL already limits rows', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users LIMIT 10', 'mysql', 500).applied)
      .toBe(false);
    expect(applyQueryAutoLimit('SELECT * FROM users OFFSET 10 LIMIT 10', 'postgres', 500).applied)
      .toBe(false);
  });

  it('does not treat nested LIMIT as the outer query limit', () => {
    expect(applyQueryAutoLimit('SELECT * FROM (SELECT * FROM users LIMIT 10) t', 'postgres', 500).sql)
      .toBe('SELECT * FROM (SELECT * FROM users LIMIT 10) t LIMIT 500');
  });

  it('preserves an existing ORDER BY LIMIT OFFSET clause', () => {
    const sql = 'SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 40';
    expect(applyQueryAutoLimit(sql, 'postgres', 500)).toEqual({
      sql,
      applied: false,
      maxRows: 500,
    });
  });

  it('limits GROUP BY and HAVING after the complete query', () => {
    const sql = 'SELECT dept_id, COUNT(*) total FROM users GROUP BY dept_id HAVING COUNT(*) > 1 ORDER BY total DESC';
    expect(applyQueryAutoLimit(sql, 'postgres', 500).sql)
      .toBe(`${sql} LIMIT 500`);
  });

  it('ignores LIMIT text in block comments and compact PostgreSQL line comments', () => {
    expect(applyQueryAutoLimit('SELECT id FROM users /* LIMIT 10 */ ORDER BY id', 'postgres', 500).sql)
      .toBe('SELECT id FROM users /* LIMIT 10 */ ORDER BY id LIMIT 500');
    expect(applyQueryAutoLimit('SELECT id FROM users --LIMIT 10', 'postgres', 500).sql)
      .toBe('SELECT id FROM users LIMIT 500 --LIMIT 10');
    expect(applyQueryAutoLimit('--preview\nSELECT id FROM users', 'postgres', 500).sql)
      .toBe('--preview\nSELECT id FROM users LIMIT 500');
  });

  it('keeps compact double-minus expressions executable for MySQL', () => {
    expect(applyQueryAutoLimit('SELECT 1--2 AS value', 'mysql', 500).sql)
      .toBe('SELECT 1--2 AS value LIMIT 500');
  });

  it('does not add another Oracle limit when Oracle SQL already limits rows', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users WHERE ROWNUM <= 10', 'oracle', 500).applied)
      .toBe(false);
    expect(applyQueryAutoLimit('SELECT * FROM users FETCH FIRST 10 ROWS ONLY', 'oracle', 500).applied)
      .toBe(false);
  });

  it('keeps an ordinary Dameng query with an explicit limit unchanged', () => {
    const sql = 'SELECT ID, NAME FROM VULNERABILITY_INFO_T LIMIT 25';

    expect(applyQueryAutoLimit(sql, 'dameng', 5000)).toEqual({
      sql,
      applied: false,
      maxRows: 5000,
    });
  });

  it('keeps WITH UR after an existing Dameng limit', () => {
    expect(applyQueryAutoLimit('SELECT ID FROM USERS LIMIT 25 WITH UR;', 'dameng', 5000)).toEqual({
      sql: 'SELECT ID FROM USERS LIMIT 25 WITH UR;',
      applied: false,
      maxRows: 5000,
    });
  });

  it('does not wrap Oracle FOR UPDATE queries', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users FOR UPDATE', 'oracle', 500).applied)
      .toBe(false);
  });

  it.each([
    ['oracle', 'SELECT IMP_BASICINFO.SEQ_HIS_AZA7.nextval FROM dual'],
    ['dameng', 'SELECT "APP"."ORDER_SEQ".CURRVAL FROM dual'],
  ])('does not wrap %s sequence pseudo-column queries', (dbType, sql) => {
    expect(applyQueryAutoLimit(sql, dbType, 500)).toEqual({
      sql,
      applied: false,
      maxRows: 500,
    });
  });

  it('does not mistake sequence pseudo-column text in Oracle strings or comments for executable SQL', () => {
    const sql = "SELECT 'SEQ.NEXTVAL' AS sample FROM dual /* OTHER_SEQ.CURRVAL */";
    const result = applyQueryAutoLimit(sql, 'oracle', 500);

    expect(result.applied).toBe(true);
    expect(result.sql).toContain('WHERE ROWNUM <= 500');
  });

  it('does not add another SQL Server limit when SQL already uses TOP', () => {
    expect(applyQueryAutoLimit('SELECT TOP 10 * FROM users', 'sqlserver', 500).applied)
      .toBe(false);
  });

  it('adds generic LIMIT before locking clauses', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users FOR UPDATE', 'mysql', 500).sql)
      .toBe('SELECT * FROM users LIMIT 500 FOR UPDATE');
  });

  it('adds generic LIMIT before OFFSET clauses', () => {
    expect(applyQueryAutoLimit('SELECT * FROM users OFFSET 10', 'postgres', 500).sql)
      .toBe('SELECT * FROM users LIMIT 500 OFFSET 10');
  });

  it('does not limit non-select statements', () => {
    expect(applyQueryAutoLimit('UPDATE users SET name = \'a\'', 'mysql', 500).applied)
      .toBe(false);
  });

  // 回归：`WITH ... AS (...)` 的 leading keyword 是 `with`，曾被 `keyword !== 'select'`
  // 直接拒掉，导致 CTE 查询完全拿不到行数上限 —— 用户设「分页 1」仍返回全部行。
  // 行数上限必须作用在主查询上，同时不能碰 CTE 定义体内的同名关键字。
  describe('CTE 主查询', () => {
    const cteSQL = `WITH rfm AS (
  SELECT c.id, AVG(monetary) AS avg_monetary
  FROM customers c
  GROUP BY c.id
)
SELECT rfm.id, rfm.avg_monetary
FROM rfm
ORDER BY rfm.avg_monetary DESC`;

    it.each(limitDialects)('adds generic LIMIT to the main query for %s connections', (dbType) => {
      const result = applyQueryAutoLimit(cteSQL, dbType, 1);

      expect(result.applied).toBe(true);
      expect(result.sql.endsWith('LIMIT 1')).toBe(true);
      // CTE 定义体必须原样保留，且只注入一次上限。
      expect(result.sql).toContain('WITH rfm AS (');
      expect(result.sql.match(/LIMIT /g)).toHaveLength(1);
    });

    it('does not mistake a LIMIT inside the CTE body for the outer query limit', () => {
      const result = applyQueryAutoLimit('WITH t AS (SELECT id FROM a LIMIT 5) SELECT * FROM t', 'postgres', 10);

      expect(result.applied).toBe(true);
      expect(result.sql).toBe('WITH t AS (SELECT id FROM a LIMIT 5) SELECT * FROM t LIMIT 10');
    });

    it('keeps an existing outer LIMIT unchanged', () => {
      expect(applyQueryAutoLimit('WITH t AS (SELECT id FROM a) SELECT * FROM t LIMIT 3', 'postgres', 10).applied)
        .toBe(false);
    });

    it('handles multiple comma-separated CTE definitions', () => {
      const result = applyQueryAutoLimit(
        'WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a JOIN b ON 1=1',
        'postgres',
        10,
      );

      expect(result.applied).toBe(true);
      expect(result.sql.endsWith('LIMIT 10')).toBe(true);
    });

    it('adds SQL Server TOP to the main query, not the CTE body', () => {
      const result = applyQueryAutoLimit(cteSQL, 'sqlserver', 1);

      expect(result.applied).toBe(true);
      expect(result.sql).toContain('SELECT TOP 1 rfm.id');
      expect(result.sql).not.toContain('SELECT TOP 1 c.id');
    });

    it('keeps the CTE at top level for Oracle by appending FETCH FIRST', () => {
      const result = applyQueryAutoLimit(cteSQL, 'oracle', 1);

      expect(result.applied).toBe(true);
      // ROWNUM 包装会把 `WITH` 塞进内联视图，那里子查询因子化不合法的风险很高。
      expect(result.sql).not.toContain('ROWNUM');
      expect(result.sql.startsWith('WITH rfm AS (')).toBe(true);
      expect(result.sql.endsWith('FETCH FIRST 1 ROWS ONLY')).toBe(true);
    });

    it('never injects a row limit into a non-select CTE body', () => {
      expect(applyQueryAutoLimit('WITH t AS (SELECT id FROM a) UPDATE b SET x = 1 WHERE id IN (SELECT id FROM t)', 'postgres', 10).applied)
        .toBe(false);
      expect(applyQueryAutoLimit('WITH t AS (SELECT id FROM a) DELETE FROM b WHERE id IN (SELECT id FROM t)', 'postgres', 10).applied)
        .toBe(false);
      expect(applyQueryAutoLimit('WITH t AS (SELECT id FROM a) INSERT INTO b SELECT * FROM t', 'postgres', 10).applied)
        .toBe(false);
    });
  });
});
