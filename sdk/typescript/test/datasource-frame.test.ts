import { describe, expect, it } from 'vitest';
import { DataSourceDispatcher } from '../src/datasource.js';
const signal = () => new AbortController().signal;
const id = 'A'.repeat(43);
const request = (operation: string) => ({ protocolVersion: 1, operation, sessionId: id,
  ...(operation === 'connect' ? { config: { host: 'memory', port: 0, user: '', password: 'p', database: 'fixture' } } : { query: 'SELECT 1' }) });
describe('data source result frame', () => {
  it('accepts four legal multibyte rows and rejects the fifth', async () => {
    const text = '文'.repeat(80000);
    const run = async (rows: number) => {
      const dispatcher = new DataSourceDispatcher({ connect: () => {}, close: () => {}, query: () => ({ fields: ['id'], rows: Array.from({ length: rows }, () => ({ id: text })) }) });
      await dispatcher.handle(request('connect'), signal());
      return dispatcher.handle(request('query'), signal());
    };
    await expect(run(4)).resolves.toMatchObject({ fields: ['id'] });
    await expect(run(5)).rejects.toMatchObject({ message: 'datasource limit exceeded', code: -32000 });
  });
});
