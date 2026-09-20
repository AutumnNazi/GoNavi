import { describe, expect, it } from 'vitest';

import { formatDataViewerQueryError } from './dataViewerQueryError';

describe('formatDataViewerQueryError', () => {
  it('maps timeout errors to catalog copy when the translator resolves keys', () => {
    const formatted = formatDataViewerQueryError(
      'mysql',
      'context deadline exceeded',
      (key) => {
        if (key === 'data_viewer.message.query_timeout') {
          return '查询超过连接超时时间，已中断。请调大连接超时时间，或减少查询范围后重试。';
        }
        return key;
      },
    );

    expect(formatted).toBe('查询超过连接超时时间，已中断。请调大连接超时时间，或减少查询范围后重试。');
    expect(formatted).not.toBe('data_viewer.message.query_timeout');
  });

  it('does not surface the raw i18n key when the translator misses the catalog', () => {
    const formatted = formatDataViewerQueryError(
      'mysql',
      'context deadline exceeded',
      (key) => key,
    );

    expect(formatted).not.toBe('data_viewer.message.query_timeout');
    expect(formatted).toContain('interrupted');
  });

  it('maps DuckDB interrupt errors to DuckDB timeout copy', () => {
    const formatted = formatDataViewerQueryError(
      'duckdb',
      'INTERRUPT Error: Interrupted!',
      (key) => (key === 'data_viewer.message.duckdb_query_timeout' ? 'duckdb-timeout' : key),
    );

    expect(formatted).toBe('duckdb-timeout');
  });

  it('keeps non-timeout driver errors unchanged', () => {
    expect(formatDataViewerQueryError('mysql', 'column id does not exist', (key) => key))
      .toBe('column id does not exist');
  });
});
