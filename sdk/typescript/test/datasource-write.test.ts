import { describe, expect, it } from 'vitest';
import { DataSourceDispatcher } from '../src/datasource.js';
import { decodeDataSourceRequest } from '../src/datasourceValidation.js';
import type { DataSourceOperations } from '../src/datasourceTypes.js';
import type { JSONValue } from '../src/types.js';

const signal = () => new AbortController().signal;
const id = 'A'.repeat(43);
const read = (operation: string): JSONValue => ({ protocolVersion: 1, operation, sessionId: id,
  ...(operation === 'connect' ? { config: { host: 'memory', port: 0, user: '', password: '', database: 'fixture' } } : {}) });
const write = (operation: string, transactionId?: string): JSONValue => ({ protocolVersion: 2, operation, sessionId: id,
  ...(transactionId === undefined ? {} : { transactionId }), ...(operation === 'exec' || operation === 'query' ? { query: 'UPDATE people SET name = 1' } : {}) });
const fixture = (): DataSourceOperations => ({
  connect: () => {}, close: () => {},
  exec: () => ({ rowsAffected: 2 }), begin: () => 'tx-1', commit: () => {}, rollback: () => {},
});
async function connected(operations = fixture()) {
  const dispatcher = new DataSourceDispatcher(operations);
  await dispatcher.handle(read('connect'), signal());
  return dispatcher;
}

describe('writable datasource protocol v2', () => {
  it('dispatches exec, begin, commit and rollback with transaction identity', async () => {
    let seen = '';
    const dispatcher = await connected({ ...fixture(), exec: (request) => { seen = request.transactionId ?? ''; return { rowsAffected: 2 }; } });
    expect(await dispatcher.handle(write('begin'), signal())).toEqual({ ok: true, transactionId: 'tx-1' });
    expect(await dispatcher.handle(write('exec', 'tx-1'), signal())).toEqual({ ok: true, rowsAffected: 2 });
    expect(seen).toBe('tx-1');
    expect(await dispatcher.handle(write('commit', 'tx-1'), signal())).toEqual({ ok: true });
    expect(await dispatcher.handle(write('rollback', 'tx-1'), signal())).toEqual({ ok: true });
  });
  it.each([
    write('exec'),
    write('commit'),
    write('commit', 'bad/id'),
    { protocolVersion: 2, operation: 'begin', sessionId: id, transactionId: 'tx-1' },
    { protocolVersion: 2, operation: 'rollback', sessionId: id, transactionId: 'tx-1', query: 'SELECT 1' },
    { protocolVersion: 2, operation: 'ping', sessionId: id },
    { protocolVersion: 1, operation: 'query', sessionId: id, query: 'SELECT 1', transactionId: 'tx-1' },
  ])('rejects malformed write envelopes %#', (value) => {
    expect(() => decodeDataSourceRequest(value)).toThrow();
  });
  it('rejects absent callbacks and malformed results', async () => {
    const dispatcher = await connected({ connect: () => {}, close: () => {} });
    await expect(dispatcher.handle(write('begin'), signal())).rejects.toMatchObject({ code: -32601 });
    const malformed = await connected({ ...fixture(), begin: () => 'two words' });
    await expect(malformed.handle(write('begin'), signal())).rejects.toThrow('invalid datasource result');
    const negative = await connected({ ...fixture(), exec: () => ({ rowsAffected: -1 }) });
    await expect(negative.handle(write('exec', 'tx-1'), signal())).rejects.toThrow('invalid datasource result');
  });
});
