import { describe, expect, it } from 'vitest';
import { DataSourceDispatcher } from '../src/datasource.js';
import type { DataSourceOperations, DataSourceRequest } from '../src/datasourceTypes.js';
import type { JSONValue } from '../src/types.js';

const signal = () => new AbortController().signal;
const id = 'A'.repeat(43); // The canonical base64url encoding of 32 zero bytes matches host token shape.
const request = (operation: string, sessionId = id): JSONValue => ({ protocolVersion: 1, operation, sessionId,
  ...(operation === 'connect' ? { config: { host: 'memory', port: 0, user: '', password: 'not-logged', database: 'fixture' } } : {}),
  ...(operation === 'query' ? { query: 'SELECT 1' } : {}) });
const fixture = (overrides: DataSourceOperations = {}): DataSourceOperations => ({
  connect: () => {}, close: () => {}, ping: () => {},
  query: () => ({ fields: ['value'], rows: [{ value: 9007199254740993n }] }),
  allColumns: () => [{ tableName: 'people', name: 'id', type: 'INTEGER' }],
  foreignKeys: () => [], ...overrides,
});
async function connected(operations: DataSourceOperations = fixture()) {
  const dispatcher = new DataSourceDispatcher(operations);
  await dispatcher.handle(request('connect'), signal());
  return dispatcher;
}

describe('read-only datasource SDK', () => {
  it('passes selected config, exact metadata envelopes and precise bigint strings', async () => {
    let selected: DataSourceRequest | undefined;
    const dispatcher = await connected(fixture({ connect: (value) => { selected = value; } }));
    expect(selected?.config).toEqual({ host: 'memory', port: 0, user: '', password: 'not-logged', database: 'fixture', connectionParams: '' });
    expect(await dispatcher.handle(request('query'), signal())).toEqual({ fields: ['value'], rows: [{ value: '9007199254740993' }] });
    expect(await dispatcher.handle(request('allColumns'), signal())).toEqual({ allColumns: [{ tableName: 'people', name: 'id', type: 'INTEGER' }] });
    expect(await dispatcher.handle(request('foreignKeys'), signal())).toEqual({ foreignKeys: [] });
    await expect(dispatcher.handle(request('indexes'), signal())).rejects.toMatchObject({ code: -32601 });
    await dispatcher.close(signal());
  });
  it.each([
    { protocolVersion: 2, operation: 'ping', sessionId: id },
    { protocolVersion: 1, operation: 'exec', sessionId: id },
    { protocolVersion: 1, operation: 'connect', sessionId: id, config: { ssh: { password: 'secret' } } },
    { protocolVersion: 1, operation: 'query', sessionId: id, query: 'SELECT 1', config: {} },
    { protocolVersion: 1, operation: 'connect', sessionId: '../id', config: {} },
    { protocolVersion: 1, operation: 'connect', sessionId: 'valid\n', config: {} },
    { protocolVersion: 1, operation: 'connect', sessionId: id, config: { password: null } },
  ])('rejects invalid and write-bearing envelopes %#', async (value) => {
    await expect(new DataSourceDispatcher(fixture()).handle(value, signal())).rejects.toThrow();
  });
  it('rejects unsafe numbers, undeclared fields and absent arrays', async () => {
    for (const query of [
      () => ({ fields: ['value'], rows: [{ value: 9007199254740992 }] }),
      () => ({ fields: ['value'], rows: [{ other: 1 }] }),
      () => ({ fields: Array.from({ length: 513 }, (_, index) => String(index)), rows: [] }),
    ]) {
      const dispatcher = await connected(fixture({ query }));
      await expect(dispatcher.handle(request('query'), signal())).rejects.toThrow();
    }
    const dispatcher = await connected(fixture({ tables: () => JSON.parse('null') as string[] }));
    await expect(dispatcher.handle(request('tables'), signal())).rejects.toThrow('array is required');
  });
  it('fences close-before-connect and cleans a late connect twice', async () => {
    let release: (() => void) | undefined;
    let closes = 0;
    const dispatcher = new DataSourceDispatcher(fixture({ connect: () => new Promise<void>((resolve) => { release = resolve; }), close: () => { closes++; } }));
    const connecting = dispatcher.handle(request('connect'), signal());
    await dispatcher.handle(request('close'), signal());
    release?.();
    await expect(connecting).rejects.toMatchObject({ code: -32800 });
    expect(closes).toBe(2);
    await expect(dispatcher.handle(request('ping'), signal())).rejects.toThrow('session unavailable');
    await dispatcher.handle(request('close', 'before_connect'), signal());
    await expect(dispatcher.handle(request('connect', 'before_connect'), signal())).rejects.toThrow('session unavailable');
  });
  it('cancels all queries during dispatcher cleanup', async () => {
    let aborted = 0;
    const dispatcher = await connected(fixture({ query: (_request, current) => new Promise((resolve) => {
      current.addEventListener('abort', () => { aborted++; resolve({ fields: [], rows: [] }); }, { once: true });
    }) }));
    const query = dispatcher.handle(request('query'), signal());
    await dispatcher.close(signal());
    await expect(query).rejects.toMatchObject({ code: -32800 });
    expect(aborted).toBe(1);
  });
  it('copies callback registration so later option mutation cannot disable cleanup', async () => {
    let closes = 0;
    const operations = fixture({ close: () => { closes++; } });
    const dispatcher = await connected(operations);
    operations.close = undefined;
    await dispatcher.close(signal());
    expect(closes).toBe(1);
  });
  it('bounds active sessions and never dispatches a pre-canceled connect', async () => {
    let calls = 0;
    const dispatcher = new DataSourceDispatcher(fixture({ connect: () => { calls++; } }));
    const aborted = new AbortController(); aborted.abort();
    await expect(dispatcher.handle(request('connect'), aborted.signal)).rejects.toMatchObject({ code: -32800 });
    expect(calls).toBe(0);
    for (let index = 0; index < 128; index++) await dispatcher.handle(request('connect', 'active_' + index), signal());
    await expect(dispatcher.handle(request('connect', 'overflow'), signal())).rejects.toThrow('limit exceeded');
    await dispatcher.close(signal());
    await expect(dispatcher.handle(request('connect', 'after_stop'), signal())).rejects.toThrow('session unavailable');
  });
  it('accepts normal metadata traffic beyond the recent tombstone window', async () => {
    const dispatcher = new DataSourceDispatcher(fixture());
    for (let index = 0; index < 4100; index++) {
      await dispatcher.handle(request('connect', 'metadata_' + index), signal());
      await dispatcher.handle(request('close', 'metadata_' + index), signal());
    }
    await expect(dispatcher.handle(request('connect', 'fresh_session'), signal())).resolves.toEqual({ ok: true });
    await dispatcher.close(signal());
  });
});
