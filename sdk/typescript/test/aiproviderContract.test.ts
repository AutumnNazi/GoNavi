import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderDispatcher, Protocol } from '../src/index.js';
import type { AIProviderGenerate, AIProviderLimits, AIProviderRegistryOptions } from '../src/index.js';
import type { JSONValue } from '../src/types.js';

const models = [{ id: 'fixture', name: 'Fixture', contextWindow: 4096, maxOutputTokens: 1024 }];
const all: AIProviderDispatcher[] = [];
const signal = () => new AbortController().signal;
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function create(generate: AIProviderGenerate, limits: Partial<AIProviderLimits> = {}) {
 const dispatcher = new AIProviderDispatcher({ providers: { provider: { models, supportsTools: true, supportsImages: false, generate } }, limits });
 all.push(dispatcher); return dispatcher;
}
function wire(operation: string, id = 'request'): JSONValue {
 return { protocolVersion: 1, operation, providerId: 'provider', requestId: id, ...(operation === 'start' ? {
  config: { baseUrl: '', apiKey: '', model: 'fixture' }, request: { messages: [{ role: 'user', content: '' }], temperature: 0, maxTokens: 0 },
 } : {}) };
}
afterEach(() => { for (const dispatcher of all.splice(0)) dispatcher.abort(); vi.useRealTimers(); });

describe('final provider contract boundaries', () => {
 it.each([65, 128, 129])('bounds request definitions separately from returned calls: %i', async (count) => {
  const dispatcher = create(async () => ({ finishReason: 'stop' }));
  const start = wire('start') as Record<string, JSONValue>;
  const request = start.request as Record<string, JSONValue>;
  request.tools = Array.from({ length: count }, (_, index) => ({ type: 'function', function: { name: 'tool-' + index, description: '', parameters: { type: 'object' } } }));
  if (count <= 128) await expect(dispatcher.handle(start, signal())).resolves.toEqual({ accepted: true });
  else await expect(dispatcher.handle(start, signal())).rejects.toMatchObject({ message: 'invalid_request' });
 });

 it('cancels an abandoned live job from a real timer without a later request', async () => {
  vi.useFakeTimers(); let aborted = false;
  const dispatcher = create(async (_request, current) => {
   await new Promise<void>((resolve) => current.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
   return { finishReason: 'stop' };
  }, { idleLeaseMs: 30, maxDurationMs: 1000 });
  await dispatcher.handle(wire('start'), signal()); await flush();
  await vi.advanceTimersByTimeAsync(30);
  expect(aborted).toBe(true);
  await expect(dispatcher.handle(wire('pull'), signal())).rejects.toMatchObject({ message: 'deadline' });
  expect(vi.getTimerCount()).toBe(0);
 });

 it('renews the active lease for an empty valid pull and never frees an uncooperative worker', async () => {
  vi.useFakeTimers(); let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const dispatcher = create(async () => { await blocked; return { finishReason: 'stop' }; }, { maxWorkers: 1, idleLeaseMs: 30, pullWaitMs: 1 });
  await dispatcher.handle(wire('start'), signal()); await flush();
  await vi.advanceTimersByTimeAsync(20);
  const pending = dispatcher.handle(wire('pull'), signal());
  await vi.advanceTimersByTimeAsync(1); await expect(pending).resolves.toEqual({ events: [] });
  await vi.advanceTimersByTimeAsync(20);
  await expect(dispatcher.handle(wire('start', 'new'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
  await vi.advanceTimersByTimeAsync(9);
  await expect(dispatcher.handle(wire('pull'), signal())).rejects.toMatchObject({ message: 'deadline' });
  await expect(dispatcher.handle(wire('start', 'new'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
  release(); await flush();
  await expect(dispatcher.handle(wire('start', 'new'), signal())).resolves.toEqual({ accepted: true });
 });

 it('aborts roots before waiting for a blocked shutdown acknowledgement', async () => {
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  let aborted = false;
  const dispatcher = create(async (_request, current) => {
   await new Promise<void>((resolve) => current.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
   return { finishReason: 'stop' };
  });
  await dispatcher.handle(wire('start'), signal()); await flush();
  const protocol = new Protocol({ handlers: { provider: dispatcher.handle }, send: async () => { await blocked; }, onClose: dispatcher.abort });
  protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'plugin.shutdown' }));
  expect(aborted).toBe(true);
  release(); await flush(); await dispatcher.close();
 });

 it('retains complete offered tool calls on a length terminal, matching Go and the adapter', async () => {
  const call = { id: 'call-1', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } };
  const dispatcher = create(async () => ({ finishReason: 'length', toolCalls: [call] }));
  const start = wire('start') as Record<string, JSONValue>;
  (start.request as Record<string, JSONValue>).tools = [{ type: 'function', function: { name: 'lookup', description: '', parameters: { type: 'object' } } }];
  await dispatcher.handle(start, signal()); await flush();
  await expect(dispatcher.handle(wire('pull'), signal())).resolves.toMatchObject({ events: [{ type: 'done', finishReason: 'length', toolCalls: [call] }] });
 });

 it('does not accept wildcard single-generator construction', () => {
  expect(() => new AIProviderDispatcher({ models, supportsTools: true, supportsImages: false, generate: async () => ({ finishReason: 'stop' }) } as unknown as AIProviderRegistryOptions)).toThrow();
 });
});
