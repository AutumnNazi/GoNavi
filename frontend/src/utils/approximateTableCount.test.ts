import { describe, expect, it } from 'vitest';

import {
  buildOracleApproximateTotalSql,
  buildMySQLApproximateTotalSql,
  parseApproximateTableCountRow,
  resolveApproximateTableCountStrategy,
} from './approximateTableCount';

describe('approximateTableCount', () => {
  it.each(['mysql', 'mariadb', 'goldendb', 'oceanbase', 'tidb'])('uses the shared MySQL contract for %s', dbType => {
    expect(resolveApproximateTableCountStrategy({ dbType, whereSQL: '' })).toBe('mysql-table-rows');
    expect(resolveApproximateTableCountStrategy({ dbType, whereSQL: 'WHERE id > 1' })).toBe('none');
  });

  it.each(['postgres', 'doris', 'diros', 'starrocks', 'unknown'])('does not expand the MySQL strategy to %s', dbType => {
    expect(resolveApproximateTableCountStrategy({ dbType, whereSQL: '' })).toBe('none');
  });

  it('matches exact MySQL metadata names with SQL-mode-independent literals', () => {
    const sql = buildMySQLApproximateTotalSql({ dbName: "a'b", tableName: 'a.b\\c' });
    expect(sql).toContain('0x612762');
    expect(sql).toContain('TABLE_TYPE = \'BASE TABLE\'');
    expect(sql).toContain('TABLE_ROWS AS approx_total');
    expect(sql).not.toContain("a'b");
  });
  it('uses oracle metadata approximate total only for unfiltered full-table preview', () => {
    expect(resolveApproximateTableCountStrategy({ dbType: 'oracle', whereSQL: '' })).toBe('oracle-num-rows');
    expect(resolveApproximateTableCountStrategy({ dbType: 'oracle', whereSQL: 'WHERE id = 1' })).toBe('none');
  });

  it('keeps duckdb approximate count on unfiltered previews', () => {
    expect(resolveApproximateTableCountStrategy({ dbType: 'duckdb', whereSQL: '' })).toBe('duckdb-estimated-size');
  });

  it('builds Oracle approx count SQL from owner and table name', () => {
    expect(buildOracleApproximateTotalSql({ dbName: 'HR', tableName: 'HR.EMPLOYEES' })).toContain("owner = 'HR'");
    expect(buildOracleApproximateTotalSql({ dbName: 'HR', tableName: 'HR.EMPLOYEES' })).toContain("table_name = 'EMPLOYEES'");
  });

  it('parses approximate total rows using preferred keys', () => {
    expect(parseApproximateTableCountRow({ NUM_ROWS: '1234' }, ['num_rows'])).toBe(1234);
    expect(parseApproximateTableCountRow({ approx_total: 5678 }, ['approx_total'])).toBe(5678);
  });
});
