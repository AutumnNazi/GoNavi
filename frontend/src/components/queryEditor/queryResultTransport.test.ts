import { describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';

import { expandCompactQueryResult, invokeCompactDBQueryMulti } from './queryResultTransport';

describe('query result transport', () => {
  it.each(['inline', 'gzip'] as const)('preserves special column names in %s results without changing row prototypes', (encoding) => {
    const columns = ['id', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const protoValues = ['sql-value', null, { nested: 'sql-json-value' }];
    const expectedRows = protoValues.map((value, index) => ({
      id: index,
      ['__proto__']: value,
      constructor: 'constructor-value',
      toString: 'toString-value',
      hasOwnProperty: 'hasOwnProperty-value',
    }));
    const compactData = [{ columns, rowValues: expectedRows.map((row) => columns.map((column) => row[column as keyof typeof row])) }];
    const payload = encoding === 'inline'
      ? { success: true, data: compactData }
      : {
        success: true,
        data: null,
        dataEncoding: 'gzip-base64-json',
        encodedData: btoa(String.fromCharCode(...gzipSync(strToU8(JSON.stringify(compactData))))),
      };
    const result = expandCompactQueryResult<Record<string, unknown>>(payload);
    expect(result).toEqual({ success: true, data: [{ columns, rows: expectedRows }] });
    const rows = (result.data as Array<{ rows: Record<string, unknown>[] }>)[0].rows;
    rows.forEach((row, index) => {
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      expect(Object.keys(row)).toEqual(columns);
      expect(Object.prototype.hasOwnProperty.call(row, '__proto__')).toBe(true);
      expect(JSON.parse(JSON.stringify(row))).toEqual(expectedRows[index]);
    });
  });

  it('expands compact rows without changing result metadata', () => {
    const result = expandCompactQueryResult({
      success: true,
      durationMs: 80,
      data: [{
        columns: ['id', 'name'],
        rowValues: [[1, 'alpha'], [2, null]],
        statementIndex: 2,
        truncated: true,
      }],
    });

    expect(result).toEqual({
      success: true,
      durationMs: 80,
      data: [{
        columns: ['id', 'name'],
        rows: [{ id: 1, name: 'alpha' }, { id: 2, name: null }],
        statementIndex: 2,
        truncated: true,
      }],
    });
  });

  it('expands gzip encoded compact rows', () => {
    const compactData = [{
      columns: ['id', 'name'],
      rowValues: [[1, 'alpha'], [2, 'beta']],
      statementIndex: 1,
    }];
    const encodedData = btoa(String.fromCharCode(...gzipSync(strToU8(JSON.stringify(compactData)))));

    expect(expandCompactQueryResult({
      success: true,
      data: null,
      dataEncoding: 'gzip-base64-json',
      encodedData,
    })).toEqual({
      success: true,
      data: [{
        columns: ['id', 'name'],
        rows: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }],
        statementIndex: 1,
      }],
    });
  });

  it('keeps legacy query results and falls back when the compact binding is unavailable', async () => {
    const legacy = { success: true, data: [{ columns: ['id'], rows: [{ id: 1 }] }] };
    expect(expandCompactQueryResult(legacy)).toBe(legacy);
    const fallback = vi.fn().mockResolvedValue(legacy);

    await expect(invokeCompactDBQueryMulti([{}, '', 'SELECT 1', 'query-1'], fallback)).resolves.toBe(legacy);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('routes the compact query through the request-scoped Web RPC caller', async () => {
    const args: [unknown, string, string, string] = [{ type: 'sqlite' }, 'main', 'SELECT 1', 'query-1'];
    const compact = { success: true, data: [{ columns: ['id'], rowValues: [[1]] }] };
    const fallback = vi.fn().mockResolvedValue({ success: true, data: [] });
    const invokeRequestScopedApp = vi.fn().mockResolvedValue(compact);

    await expect(invokeCompactDBQueryMulti(args, fallback, invokeRequestScopedApp)).resolves.toBe(compact);
    expect(invokeRequestScopedApp).toHaveBeenCalledWith(
      'DBQueryMultiCompact',
      args,
      expect.any(Function),
    );
    expect(fallback).not.toHaveBeenCalled();
  });
});
