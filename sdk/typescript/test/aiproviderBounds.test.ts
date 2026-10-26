import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER_DEFAULT_LIMITS, AIProviderDispatcher } from '../src/aiprovider.js';
import type { AIProviderRegistration, AIProviderLifecycleOptions, AIProviderEvent, AIProviderGenerate, AIProviderLimits } from '../src/aiprovider.js';
import type { JSONValue } from '../src/types.js';

const models = [{ id: 'fixture', name: 'Fixture', contextWindow: 4096, maxOutputTokens: 1024 }];
const signal = () => new AbortController().signal;
const dispatchers: AIProviderDispatcher[] = [];
const flush = async () => { for (let index = 0; index < 32; index++) await Promise.resolve(); };
const gate = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
function wire(operation: string, requestId = 'A'.repeat(43), providerId = 'provider'): JSONValue {
  return { protocolVersion: 1, operation, providerId, requestId, ...(operation === 'start' ? {
    config: { baseUrl: '', apiKey: '', model: 'fixture' }, request: { messages: [{ role: 'user', content: '' }], temperature: 0, maxTokens: 0 },
  } : {}) };
}
function fixture(generate: AIProviderGenerate = async () => ({ finishReason: 'stop' }), options: Partial<AIProviderRegistration> & AIProviderLifecycleOptions & { providerId?: string } = {}) {
  const { limits, rootSignal, providerId, ...overrides } = options;
  const registration = { models, supportsTools: true, supportsImages: false, generate: generate, ...overrides };
  const providers = providerId ? { [providerId]: registration } : { provider: registration, other: registration };
  const dispatcher = new AIProviderDispatcher({ providers, limits, rootSignal });
  dispatchers.push(dispatcher); return dispatcher;
}
async function pull(dispatcher: AIProviderDispatcher, id?: string) {
  return await dispatcher.handle(wire('pull', id), signal()) as { events: AIProviderEvent[] };
}
async function drain(dispatcher: AIProviderDispatcher, id?: string): Promise<AIProviderEvent[]> {
  const events: AIProviderEvent[] = [];
  for (let batch = 0; batch < 10000; batch++) {
    const value = await pull(dispatcher, id);
    expect(value.events.length).toBeLessThanOrEqual(16);
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThanOrEqual(128 * 1024);
    events.push(...value.events);
    if (events.some((event) => event.type !== 'delta')) return events;
  }
  throw new Error('test stream did not terminate');
}
afterEach(() => { for (const dispatcher of dispatchers.splice(0)) dispatcher.abort(); vi.useRealTimers(); });

describe('AI provider queue and lifetime bounds', () => {
  it('applies 448KiB delta backpressure and returns at most 128KiB per batch', async () => {
    let emitted = 0;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      for (let index = 0; index < 9; index++) { await emit({ content: 'x'.repeat(60000) }); emitted++; }
      return { finishReason: 'stop' };
    });
    await dispatcher.handle(wire('start'), signal()); await flush();
    expect(emitted).toBe(7);
    const first = await pull(dispatcher);
    expect(first.events).toHaveLength(2);
    expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThanOrEqual(128 * 1024);
    await flush(); expect(emitted).toBe(9);
    const events = [...first.events, ...await drain(dispatcher)];
    expect(events).toHaveLength(10);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    expect(events[9]).toEqual({ sequence: 10, type: 'done', finishReason: 'stop' });
  });

  it('reserves the 64th queue position for a terminal after 63 deltas', async () => {
    let finished = false;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      for (let index = 0; index < 63; index++) await emit({ content: 'x' });
      finished = true; return { finishReason: 'stop' };
    });
    await dispatcher.handle(wire('start'), signal());
    for (let index = 0; index < 5; index++) await flush();
    expect(finished).toBe(true);
    const first = await pull(dispatcher); expect(first.events).toHaveLength(16);
    const events = [...first.events, ...await drain(dispatcher)];
    expect(events).toHaveLength(64);
    expect(events[63]).toEqual({ sequence: 64, type: 'done', finishReason: 'stop' });
  });

  it.each(['"'.repeat(32768), '密'.repeat(21845)])('counts JSON escaping and UTF-8 in the per-event limit', async (content) => {
    const dispatcher = fixture(async (_start, _signal, emit) => { await emit({ content }); return { finishReason: 'stop' }; });
    await dispatcher.handle(wire('start'), signal()); await flush();
    expect(await drain(dispatcher)).toEqual([{ sequence: 1, type: 'error', code: 'limit_exceeded' }]);
  });

  it('rejects overlapping blocked emits without an unbounded list of pending producers', async () => {
    let failure: unknown;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      await emit({ content: 'accepted' });
      const blocked = emit({ content: 'waiting' }).catch((error: unknown) => { failure = error; });
      await expect(emit({ content: 'overlap' })).rejects.toMatchObject({ message: 'limit_exceeded' });
      await blocked;
      return { finishReason: 'stop' };
    }, { limits: { maxQueueEvents: 2 } });
    await dispatcher.handle(wire('start'), signal()); await flush();
    expect(await drain(dispatcher)).toEqual([{ sequence: 1, type: 'delta', content: 'accepted' }, { sequence: 2, type: 'error', code: 'limit_exceeded' }]);
    expect(failure).toMatchObject({ message: 'canceled' });
  });

  it('fences simultaneous nonempty pulls through terminal consumption', async () => {
    const dispatcher = fixture();
    await dispatcher.handle(wire('start'), signal()); await flush();
    const first = pull(dispatcher);
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'invalid_request' });
    expect(await first).toEqual({ events: [{ sequence: 1, type: 'done', finishReason: 'stop' }] });
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'invalid_request' });
  });

  it('counts all accepted bytes across drained batches and keeps terminal budget available', async () => {
    const dispatcher = fixture(async (_start, _signal, emit) => {
      for (let index = 0; index < 200; index++) await emit({ content: 'x'.repeat(60000) });
      return { finishReason: 'stop' };
    });
    await dispatcher.handle(wire('start'), signal());
    const events = await drain(dispatcher);
    expect(events[events.length - 1].type).toBe('error');
    expect(events[events.length - 1]).toMatchObject({ code: 'limit_exceeded' });
    const size = events.reduce((sum, event) => sum + new TextEncoder().encode(JSON.stringify(event)).length, 0);
    expect(size).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(size).toBeGreaterThan(7 * 1024 * 1024);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: events.length }, (_, index) => index + 1));
  });

  it('counts all accepted events across batches, reserving the final event for explicit failure', async () => {
    const dispatcher = fixture(async (_start, _signal, emit) => {
      for (let index = 0; index < 1000; index++) await emit({ content: 'x' });
      return { finishReason: 'stop' };
    }, { limits: { maxCompletionEvents: 100 } });
    await dispatcher.handle(wire('start'), signal());
    const events = await drain(dispatcher);
    expect(events).toHaveLength(100);
    expect(events[99]).toEqual({ sequence: 100, type: 'error', code: 'limit_exceeded' });
    expect(AI_PROVIDER_DEFAULT_LIMITS.maxCompletionEvents).toBe(65536);
  });

});

describe('AI provider admission limits and registry', () => {
  it('bounds recent tombstones at 4096 and never evicts actual canceled callbacks', async () => {
    const blocked = gate();
    let calls = 0;
    const dispatcher = fixture(async () => { calls++; await blocked.promise; return { finishReason: 'stop' }; });
    await dispatcher.handle(wire('start', 'worker'), signal());
    await dispatcher.handle(wire('cancel', 'worker'), signal());
    for (let index = 0; index < 4100; index++) await dispatcher.handle(wire('cancel', 'recent_' + index), signal());
    await expect(dispatcher.handle(wire('start', 'worker'), signal())).rejects.toMatchObject({ message: 'invalid_request' });
    await expect(dispatcher.handle(wire('start', 'recent_4099'), signal())).rejects.toMatchObject({ message: 'canceled' });
    await expect(dispatcher.handle(wire('start', 'recent_0'), signal())).resolves.toEqual({ accepted: true });
    expect(calls).toBe(2);
    blocked.release(); await dispatcher.close();
  });

  it('retains a timed-out callback slot even after its output expires', async () => {
    vi.useFakeTimers();
    const blocked = gate();
    const dispatcher = fixture(async () => { await blocked.promise; return { finishReason: 'stop' }; }, {
      limits: { maxWorkers: 1, maxDurationMs: 5, retentionMs: 5 },
    });
    await dispatcher.handle(wire('start'), signal());
    await vi.advanceTimersByTimeAsync(10);
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'deadline' });
    await expect(dispatcher.handle(wire('start', 'new'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
    expect(vi.getTimerCount()).toBe(0);
    blocked.release(); await flush();
    await expect(dispatcher.handle(wire('start', 'new'), signal())).resolves.toEqual({ accepted: true });
  });

  it('rejects raised, unknown, null, fractional and inconsistent limits', () => {
    const invalid: unknown[] = [null, { extra: 1 }, { maxQueueEvents: 1 }, { maxEventBytes: 1 }, { maxPullBytes: 128 },
      { maxCompletionBytes: 65536 }, { maxQueueBytes: 65536 }, { maxCompletionEvents: 1 }];
    for (const [key, value] of Object.entries(AI_PROVIDER_DEFAULT_LIMITS)) {
      invalid.push({ [key]: value + 1 }, { [key]: 0 }, { [key]: null }, { [key]: 1.5 }, { [key]: Infinity });
    }
    for (const limits of invalid) expect(() => fixture(undefined, { limits: limits as Partial<AIProviderLimits> })).toThrow();
  });

  it('copies lower limits so later mutation cannot raise queue or worker bounds', async () => {
    const blocked = gate();
    const limits = { maxWorkers: 1, maxSessions: 1 };
    const dispatcher = fixture(async () => { await blocked.promise; return { finishReason: 'stop' }; }, { limits });
    limits.maxWorkers = 16; limits.maxSessions = 16;
    await dispatcher.handle(wire('start'), signal());
    await expect(dispatcher.handle(wire('start', 'second'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
    blocked.release(); await dispatcher.close();
  });

  it('pins one declaration or routes a bounded immutable provider registry with shared worker limits', async () => {
    const pinned = fixture(undefined, { providerId: 'provider' });
    await expect(pinned.handle(wire('start', undefined, 'other'), signal())).rejects.toMatchObject({ message: 'unsupported' });
    const blocked = gate();
    const selected: string[] = [];
    const providers = {
      first: { models, supportsTools: false, supportsImages: false, generate: async () => { selected.push('first'); await blocked.promise; return { finishReason: 'stop' as const }; } },
      second: { models, supportsTools: true, supportsImages: false, generate: async () => { selected.push('second'); return { finishReason: 'stop' as const }; } },
    };
    const dispatcher = new AIProviderDispatcher({ providers, limits: { maxWorkers: 1 } }); dispatchers.push(dispatcher);
    providers.second.generate = async () => { throw new Error('mutated'); };
    await dispatcher.handle(wire('start', 'one', 'first'), signal());
    await expect(dispatcher.handle(wire('start', 'two', 'second'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
    await dispatcher.handle(wire('cancel', 'one', 'second'), signal());
    expect(selected).toEqual(['first']);
    blocked.release(); await flush();
    await dispatcher.handle(wire('start', 'two', 'second'), signal()); await flush();
    expect(selected).toEqual(['first', 'second']);
    await expect(dispatcher.handle(wire('pull', 'two', 'missing'), signal())).rejects.toMatchObject({ message: 'unsupported' });
    expect(() => new AIProviderDispatcher({ providers: Object.fromEntries(Array.from({ length: 9 }, (_, index) => ['provider' + index, providers.first])) })).toThrow();
  });
});
