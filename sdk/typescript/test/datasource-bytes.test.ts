import { describe, expect, it } from 'vitest';
import { dataSourceQuery, decodeDataSourceRequest } from '../src/datasourceValidation.js';
const query = (text: string) => ({ protocolVersion: 1, operation: 'query', sessionId: 's', query: text });
describe('data source request bytes', () => {
  it('rejects multibyte text that fits in characters but not UTF-8 bytes', () => {
    expect(() => decodeDataSourceRequest(query('文'.repeat(90000)))).toThrow(/limit exceeded/);
    expect(() => decodeDataSourceRequest({ protocolVersion: 1, operation: 'tables', sessionId: 's', database: '中'.repeat(342) })).toThrow(/limit exceeded/);
    expect(() => decodeDataSourceRequest({ protocolVersion: 1, operation: 'connect', sessionId: 's', config: { host: '中'.repeat(342), port: 1, user: 'u', password: 'p', database: 'd' } })).toThrow(/invalid datasource request/);
    expect(() => dataSourceQuery({ fields: ['中'.repeat(342)], rows: [{ ['中'.repeat(342)]: 'x' }] })).toThrow(/invalid datasource result/);
    expect(decodeDataSourceRequest(query('SELECT 1')).query).toBe('SELECT 1');
    expect(() => decodeDataSourceRequest({ ...query('SELECT 1'), padding: '文'.repeat(400000) })).toThrow(/limit exceeded/);
  });
});
