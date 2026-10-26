import { describe, expect, it } from 'vitest';
import { Protocol, ProtocolError } from '../src/protocol.js';
import { FrameReader } from '../src/framing.js';
import type { RPCResponse } from '../src/types.js';

const initialize = { apiVersion: 1, pluginId: 'example.hello', version: '1.0.0', generation: 1, config: {}, hostVersion: '1.0.0', locale: 'en', permissions: [] };
const request = (id: number | string, method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(handlers: ConstructorParameters<typeof Protocol>[0]['handlers'] = {}, maxConcurrent = 32) {
  const replies: RPCResponse[] = [];
  const protocol = new Protocol({ handlers, maxConcurrent, send: (frame) => { replies.push(JSON.parse(frame)); } });
  return { protocol, replies };
}

async function start(protocol: Protocol) {
  protocol.accept(request(1, 'plugin.initialize', initialize));
  await tick();
  await protocol.flush();
}

describe('independent protocol helper', () => {
  it('keeps ping and cancellation responsive while an async handler is waiting', async () => {
    let signal: AbortSignal | undefined;
    const { protocol, replies } = harness({ wait: (_args, current) => new Promise((resolve) => {
      signal = current;
      current.addEventListener('abort', () => resolve({ cancelled: true }), { once: true });
    }) });
    await start(protocol);
    protocol.accept(request('work', 'plugin.invoke', { commandId: 'wait', arguments: {} }));
    await tick();
    protocol.accept(request(2, 'plugin.ping'));
    await protocol.flush();
    expect(replies.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 'work' } }));
    expect(signal?.aborted).toBe(true);
    await tick();
    await protocol.flush();
    expect(replies.at(-1)).toMatchObject({ id: 'work', error: { code: -32800 } });
    protocol.close();
  });

  it('bounds work without blocking control requests and shuts down outstanding work', async () => {
    let aborted = false;
    const { protocol, replies } = harness({ wait: (_args, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve(null); }, { once: true });
    }) }, 1);
    await start(protocol);
    protocol.accept(request(2, 'plugin.invoke', { commandId: 'wait' }));
    await tick();
    protocol.accept(request(3, 'plugin.invoke', { commandId: 'wait' }));
    protocol.accept(request(4, 'plugin.ping'));
    await protocol.flush();
    expect(replies.find((r) => r.id === 3)).toMatchObject({ error: { code: -32001 } });
    expect(replies.find((r) => r.id === 4)).toMatchObject({ result: {} });
    protocol.accept(request(5, 'plugin.shutdown'));
    await protocol.flush();
    expect(aborted).toBe(true);
    expect(replies.at(-1)).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  });

  it('does not await initialization to handle heartbeat or cancel', async () => {
    const replies: RPCResponse[] = [];
    let signal: AbortSignal | undefined;
    const protocol = new Protocol({ handlers: {}, send: (frame) => { replies.push(JSON.parse(frame)); }, initialize: async (_params, current) => {
      signal = current;
      await new Promise<void>((resolve) => current.addEventListener('abort', () => resolve(), { once: true }));
    } });
    protocol.accept(request(1, 'plugin.initialize', initialize));
    await tick();
    protocol.accept(request(2, 'plugin.ping'));
    await protocol.flush();
    expect(replies[0]).toMatchObject({ id: 2, result: {} });
    protocol.close();
    expect(signal?.aborted).toBe(true);
  });

  it('returns structured errors without leaking exception details', async () => {
    const { protocol, replies } = harness({ fail: () => { throw new Error('credential'); }, public: () => { throw new ProtocolError(123, 'invalid input'); } });
    await start(protocol);
    for (const commandId of ['fail', 'public', '__proto__']) {
      protocol.accept(request(commandId, 'plugin.invoke', { commandId }));
      await tick();
    }
    protocol.accept('{');
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'plugin.ping' }));
    await protocol.flush();
    expect(replies.find((r) => r.id === 'fail')).toMatchObject({ error: { code: -32603, message: 'handler failed' } });
    expect(replies.find((r) => r.id === 'public')).toMatchObject({ error: { code: 123 } });
    expect(replies.find((r) => r.id === '__proto__')).toMatchObject({ error: { code: -32601 } });
    expect(replies.slice(-2).map((r) => r.error?.code)).toEqual([-32700, -32600]);
    protocol.close();
  });

  it('treats rejection with undefined as failure rather than successful null', async () => {
    const { protocol, replies } = harness({ fail: async () => Promise.reject(undefined) });
    await start(protocol);
    protocol.accept(request(2, 'plugin.invoke', { commandId: 'fail' }));
    await tick();
    await protocol.flush();
    expect(replies.at(-1)).toMatchObject({ id: 2, error: { code: -32603 } });
    protocol.close();
  });

  it('does not execute invoke notifications', async () => {
    let executed = false;
    const { protocol } = harness({ write: () => { executed = true; return null; } });
    await start(protocol);
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', method: 'plugin.invoke', params: { commandId: 'write' } }));
    await tick();
    expect(executed).toBe(false);
    protocol.close();
  });
});

describe('host log helper', () => {
  it('rejects a bad level locally and completes a warn call from the host object result', async () => {
    const { protocol, replies } = harness({ echo: async (_args, signal) => {
      await expect(protocol.log('debug', 'nope', signal)).rejects.toMatchObject({ code: -32602 });
      const pending = protocol.log('warn', 'snapshot ready', signal);
      await tick();
      await protocol.flush();
      const call = replies.at(-1) as { id?: string; method?: string; params?: { level: string; message: string } };
      expect(call.method).toBe('host.log');
      expect(call.params).toEqual({ level: 'warn', message: 'snapshot ready' });
      protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: {} }));
      await pending;
      return { ok: true };
    } });
    await start(protocol);
    protocol.accept(request('call', 'plugin.invoke', { commandId: 'echo', arguments: {} }));
    for (let i = 0; i < 30; i++) await tick();
    await protocol.flush();
    expect(replies.find((reply) => reply.id === 'call')).toMatchObject({ result: { ok: true } });
    protocol.close();
  });
});

describe('host describe helper', () => {
  it('sends an empty object and returns only the host identity', async () => {
    const { protocol, replies } = harness({ echo: async (_args, signal) => protocol.describe(signal) });
    await start(protocol);
    protocol.accept(request('call', 'plugin.invoke', { commandId: 'echo', arguments: {} }));
    for (let i = 0; i < 20; i++) await tick();
    await protocol.flush();
    const call = replies.at(-1) as { id?: string; method?: string; params?: unknown };
    expect(call.method).toBe('host.describe');
    expect(call.params).toEqual({});
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { pluginId: 'example.hello', generation: 3, hostVersion: '9.9.9', locale: 'zh-CN', secret: 'nope' } }));
    for (let i = 0; i < 10; i++) await tick();
    await protocol.flush();
    expect(replies.find((reply) => reply.id === 'call')).toMatchObject({ result: { pluginId: 'example.hello', generation: 3, hostVersion: '9.9.9', locale: 'zh-CN' } });
    protocol.close();
  });
});

describe('lifecycle notification', () => {
  it('delivers running without a reply and ignores a request-shaped event', async () => {
    let seen = 0;
    const replies: { id?: unknown }[] = [];
    const protocol = new Protocol({ handlers: {}, send: (frame) => { replies.push(JSON.parse(frame)); }, onLifecycle: (event) => { seen = event.generation; } });
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', method: 'plugin.lifecycle', params: { event: 'running', generation: 4 } }));
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'plugin.lifecycle', params: { event: 'running', generation: 4 } }));
    await Promise.resolve();
    expect(seen).toBe(4);
    expect(replies.find((reply) => reply.id === 9)).toMatchObject({ error: { code: -32601 } });
    protocol.close();
  });
});

describe('bounded UTF-8 framing', () => {
  it('handles split multibyte characters and multiple lines', () => {
    const frames: string[] = [];
    const reader = new FrameReader((frame) => frames.push(frame));
    const bytes = new TextEncoder().encode('你好\n{}\n');
    reader.push(bytes.subarray(0, 2)); reader.push(bytes.subarray(2)); reader.end();
    expect(frames).toEqual(['你好', '{}']);
  });
  it('rejects oversized or incomplete input', () => {
    const reader = new FrameReader(() => {}, 2);
    expect(() => reader.push(new TextEncoder().encode('xxx'))).toThrow('frame limit');
    let seen = false;
    const bounded = new FrameReader(() => { seen = true; });
    expect(() => bounded.push(new TextEncoder().encode('文'.repeat(400000) + '\n'))).toThrow('frame limit');
    expect(seen).toBe(false);
    const partial = new FrameReader(() => {});
    partial.push(new TextEncoder().encode('{}'));
    expect(() => partial.end()).toThrow('incomplete');
  });
});
