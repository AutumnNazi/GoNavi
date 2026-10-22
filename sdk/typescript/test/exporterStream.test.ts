import { describe, expect, it } from 'vitest';
import { ExporterDispatcher, parseExporterRequest } from '../src/index.js';
import type { ExporterSnapshot, JSONValue } from '../src/index.js';

const signal = () => new AbortController().signal;
const chunk = () => ({
  protocolVersion: 2, exporterId: 'ndjson', columns: ['value'], chunkIndex: 1, chunkCount: 3,
  rows: [[{ kind: 'string', value: 'data' }]],
});
const invoke = (dispatcher: ExporterDispatcher, value: unknown) => dispatcher.handle(value as JSONValue, signal());

describe('ordered streaming exporter chunks', () => {
  it('exposes chunk identity and replies with an addressed chunk result', async () => {
    let seen: ExporterSnapshot | undefined;
    const dispatcher = new ExporterDispatcher({ ndjson: (snapshot) => { seen = snapshot; return 'chunk-text'; } });
    await expect(invoke(dispatcher, chunk())).resolves.toEqual({ protocolVersion: 2, exporterId: 'ndjson', chunkIndex: 1, rowCount: 1, text: 'chunk-text' });
    expect(seen).toMatchObject({ protocolVersion: 2, chunkIndex: 1, chunkCount: 3 });
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it.each([
    { ...chunk(), chunkIndex: -1 }, { ...chunk(), chunkIndex: 3 }, { ...chunk(), chunkCount: 0 },
    { ...chunk(), chunkIndex: undefined }, { ...chunk(), protocolVersion: 1 },
    { ...chunk(), rows: Array.from({ length: 513 }, () => [{ kind: 'string', value: 'x' }]) },
  ])('rejects malformed chunk envelopes before rendering', async (value) => {
    let calls = 0; const dispatcher = new ExporterDispatcher({ ndjson: () => { calls++; return 'ok'; } });
    await expect(invoke(dispatcher, value)).rejects.toBeDefined(); expect(calls).toBe(0);
  });

  it('parses chunk frames and keeps one-shot frames unchanged', () => {
    expect(parseExporterRequest(JSON.stringify(chunk()))).toMatchObject({ protocolVersion: 2, chunkIndex: 1, chunkCount: 3 });
    expect(parseExporterRequest(JSON.stringify({ protocolVersion: 1, exporterId: 'ndjson', columns: ['value'], rows: [] })))
      .toMatchObject({ protocolVersion: 1 });
  });
});
