import { describe, expect, it } from 'vitest';
import { ExporterDispatcher, EXPORTER_MAX_ENVELOPE_BYTES } from '../src/index.js';
import type { ExporterSnapshot, JSONValue } from '../src/index.js';

const signal = () => new AbortController().signal;
const request = () => ({ protocolVersion: 1, exporterId: 'ndjson', columns: ['value'], rows: [[{ kind: 'string', value: 'data' }]] });
const invoke = (dispatcher: ExporterDispatcher, value: unknown, current = signal()) => dispatcher.handle(value as JSONValue, current);

describe('bounded exporter dispatcher', () => {
 it('copies explicit registry and private snapshots while preserving tags and number lexemes', async () => {
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  let seen: ExporterSnapshot | undefined;
  const handlers = { constructor: async (snapshot: ExporterSnapshot) => { seen = snapshot; await blocked; return 'document'; } };
  const dispatcher = new ExporterDispatcher(handlers);
  handlers.constructor = async () => { throw new Error('mutated'); };
  const input = { protocolVersion: 1, exporterId: 'constructor', columns: [' a ', '__proto__', 'constructor', 'missing', 'null', 'json', 'binary'], rows: [[
   { kind: 'number', value: '1e400' }, { kind: 'string', value: '\0\n' }, { kind: 'number', value: '18446744073709551615' },
   { kind: 'missing' }, { kind: 'null' }, { kind: 'json', value: '{"large":18446744073709551615,"e":1e400}' }, { kind: 'binary', value: 'AAH/' },
  ]] };
  const pending = invoke(dispatcher, input); input.rows[0][0].value = 'changed'; release();
  await expect(pending).resolves.toEqual({ protocolVersion: 1, rowCount: 1, text: 'document' });
  expect(seen?.columns).toEqual(input.columns);
  expect(seen?.rows[0][0]).toEqual({ kind: 'number', value: '1e400' });
  expect(seen?.rows[0][1]).toEqual({ kind: 'string', value: '\0\n' });
  expect(Object.isFrozen(seen?.rows[0])).toBe(true);
  const ordinary = new ExporterDispatcher({ ndjson: () => 'ok' });
  await expect(invoke(ordinary, { ...request(), exporterId: 'constructor' })).rejects.toMatchObject({ message: 'unsupported' });
 });

 it.each([
  { ...request(), path: '/secret' }, { ...request(), columns: ['value', 'value'] }, { ...request(), columns: [''] },
  { ...request(), rows: null }, { ...request(), rows: [null] }, { ...request(), rows: [[{ kind: 'missing', value: '' }]] },
  { ...request(), rows: [[{ kind: 'number', value: '01' }]] }, { ...request(), rows: [[{ kind: 'number', value: 'NaN' }]] },
  { ...request(), rows: [[{ kind: 'json', value: '{"a":1,"\\u0061":2}' }]] },
  { ...request(), rows: [[{ kind: 'json', value: '"\\ud800"' }]] },
  { ...request(), rows: [[{ kind: 'binary', value: 'AB==' }]] },
 ])('rejects invalid envelopes before rendering', async (value) => {
  let calls = 0; const dispatcher = new ExporterDispatcher({ ndjson: () => { calls++; return 'ok'; } });
  await expect(invoke(dispatcher, value)).rejects.toBeDefined(); expect(calls).toBe(0);
 });

 it('never invokes custom serializers or property accessors', async () => {
  let touched = 0;
  class CustomColumns extends Array<string> { toJSON() { touched++; return ['value']; } }
  const dispatcher = new ExporterDispatcher({ ndjson: () => 'ok' });
  await expect(invoke(dispatcher, { ...request(), columns: new CustomColumns('value') })).rejects.toBeDefined();
  const cell = { kind: 'string', get value() { touched++; return 'secret'; } };
  await expect(invoke(dispatcher, { ...request(), rows: [[cell]] })).rejects.toBeDefined();
  expect(touched).toBe(0);
 });

 it.each(['', '\0', '\ud800', '"'.repeat(300000)])('rejects unsafe result text', async (text) => {
  const dispatcher = new ExporterDispatcher({ ndjson: () => text });
  await expect(invoke(dispatcher, request())).rejects.toBeDefined();
 });

 it('sanitizes renderer failure and obeys parent cancellation', async () => {
  const failed = new ExporterDispatcher({ ndjson: () => { throw new Error('private-row-secret'); } });
  await expect(invoke(failed, request())).rejects.toMatchObject({ message: 'render_failed' });
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const controller = new AbortController();
  const dispatcher = new ExporterDispatcher({ ndjson: async (_snapshot, current) => {
   entered(); await new Promise<void>((resolve) => current.addEventListener('abort', () => resolve(), { once: true })); return 'late';
  } });
  const result = invoke(dispatcher, request(), controller.signal); const rejected = expect(result).rejects.toMatchObject({ message: 'canceled' });
  await started; controller.abort(); await rejected;
  await expect(invoke(new ExporterDispatcher({ ndjson: () => '' }), { ...request(), rows: [] })).resolves.toEqual({ protocolVersion: 1, rowCount: 0, text: '' });
 });

 it('uses one shared expanded logical node budget and value-depth four', async () => {
  const dispatcher = new ExporterDispatcher({ ndjson: () => 'ok' });
  const array = (count: number) => '[' + Array(count).fill('0').join(',') + ']';
  for (const count of [65529, 65530]) {
   const value = array(count); const input = { ...request(), columns: ['a', 'b'], rows: [[{ kind: 'json', value }, { kind: 'json', value }]] };
   if (count === 65529) await expect(invoke(dispatcher, input)).resolves.toBeDefined();
   else await expect(invoke(dispatcher, input)).rejects.toMatchObject({ message: 'limit_exceeded' });
  }
  for (const depth of [28, 29]) {
   const value = '['.repeat(depth) + '0' + ']'.repeat(depth);
   const input = { ...request(), rows: [[{ kind: 'json', value }]] };
   if (depth === 28) await expect(invoke(dispatcher, input)).resolves.toBeDefined(); else await expect(invoke(dispatcher, input)).rejects.toBeDefined();
  }
  expect(EXPORTER_MAX_ENVELOPE_BYTES).toBe(512 * 1024);
 });
});
