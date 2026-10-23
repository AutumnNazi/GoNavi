import { describe, expect, it } from 'vitest';
import { ExporterDispatcher, Protocol, EXPORTER_MAX_ENVELOPE_BYTES } from '../src/index.js';
import type { JSONValue } from '../src/index.js';

const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const small = JSON.stringify({ protocolVersion: 1, exporterId: 'ndjson', columns: ['value'], rows: [[{ kind: 'string', value: 'data' }]] });
const frame = (raw: string, command = 'render', extra = '') => '{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"' + command + '","arguments":' + raw + '}' + extra + '}';
async function fixture() {
 let calls = 0; let plain = 0; const replies: { id: number; result?: JSONValue; error?: { message: string } }[] = [];
 const dispatcher = new ExporterDispatcher({ ndjson: () => { calls++; return 'document'; } });
 const protocol = new Protocol({ handlers: { render: dispatcher.handle, plain: () => { plain++; return true; } }, send: (raw) => { replies.push(JSON.parse(raw)); } });
 protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'plugin.initialize', params: { apiVersion: 1, pluginId: 'fixture', version: '1', generation: 1, config: {}, hostVersion: 'test', locale: 'en', permissions: [] } }));
 await flush();
 return { protocol, replies, calls: () => calls, plain: () => plain };
}

describe('exporter raw invocation guard', () => {
 it.each([
  small.replace('"protocolVersion":1', '"protocolVersion":1,"protocolVersion":1'),
  small.replace('"exporterId":"ndjson"', '"exporterId":"ndjson","\\u0065xporterId":"ndjson"'),
  small.replace('"exporterId"', '"ExporterId"'),
  small.replace('"protocolVersion":1', '"protocolVersion":1.0'),
  small.replace('"data"', '"\\ud800"'),
 ])('rejects original duplicate, aliases and invalid Unicode before callback', async (raw) => {
  const test = await fixture(); test.protocol.accept(frame(raw)); await flush();
  expect(test.calls()).toBe(0); expect(test.replies.at(-1)?.error).toBeDefined(); test.protocol.close();
 });

 it('charges only the actual args span, not RPC overhead', async () => {
  const row = Array.from({ length: 4 }, (_, index) => ({ kind: 'string', value: index < 3 ? 'x'.repeat(128 * 1024) : '' }));
  const request = { protocolVersion: 1, exporterId: 'ndjson', columns: ['a', 'b', 'c', 'd'], rows: [row] };
  row[3].value = 'x'.repeat(EXPORTER_MAX_ENVELOPE_BYTES - JSON.stringify(request).length);
  const raw = JSON.stringify(request); expect(raw.length).toBe(EXPORTER_MAX_ENVELOPE_BYTES);
  const test = await fixture(); test.protocol.accept(frame(raw)); await flush();
  expect(test.calls()).toBe(1); expect(test.replies.at(-1)?.result).toMatchObject({ rowCount: 1 }); test.protocol.close();
 });

 it('rejects whitespace inflation and nested fake params.arguments spans', async () => {
  const raw = '{' + ' '.repeat(EXPORTER_MAX_ENVELOPE_BYTES - small.length + 1) + small.slice(1);
  const fake = ',"extra":{"one":{"two":{"params":{"arguments":' + small + '}}}}';
  const test = await fixture(); test.protocol.accept(frame(raw, 'render', fake)); await flush();
  expect(test.calls()).toBe(0); expect(test.replies.at(-1)?.error).toBeDefined(); test.protocol.close();
 });

 it('leaves ordinary handlers without a raw guard unchanged', async () => {
  const test = await fixture(); test.protocol.accept(frame('{"a":1,"a":2}', 'plain')); await flush();
  expect(test.plain()).toBe(1); expect(test.replies.at(-1)?.result).toBe(true); test.protocol.close();
 });
});
