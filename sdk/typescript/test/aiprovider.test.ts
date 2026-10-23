import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderDispatcher } from '../src/aiprovider.js';
import type { AIProviderRegistration, AIProviderLifecycleOptions, AIProviderEvent, AIProviderGenerate } from '../src/aiprovider.js';
import { Protocol } from '../src/protocol.js';
import type { JSONValue } from '../src/types.js';

const models = [{ id: 'fixture', name: 'Fixture', contextWindow: 4096, maxOutputTokens: 1024 }];
const signal = () => new AbortController().signal;
const dispatchers: AIProviderDispatcher[] = [];
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function wire(operation: string, requestId = 'A'.repeat(43), providerId = 'provider'): JSONValue {
  return { protocolVersion: 1, operation, providerId, requestId, ...(operation === 'start' ? {
    config: { baseUrl: '', apiKey: '', model: 'fixture' },
    request: { messages: [{ role: 'user', content: 'local fixture' }], temperature: 0, maxTokens: 0 },
  } : {}) };
}
function fixture(generate: AIProviderGenerate = async () => ({ finishReason: 'stop' }), options: Partial<AIProviderRegistration> & AIProviderLifecycleOptions & { providerId?: string } = {}) {
  const { limits, rootSignal, providerId, ...overrides } = options;
  const registration = { models, supportsTools: true, supportsImages: false, generate: generate, ...overrides };
  const providers = providerId ? { [providerId]: registration } : { provider: registration, other: registration };
  const dispatcher = new AIProviderDispatcher({ providers, limits, rootSignal });
  dispatchers.push(dispatcher);
  return dispatcher;
}
async function pull(dispatcher: AIProviderDispatcher, id?: string, current = signal()) {
  return await dispatcher.handle(wire('pull', id), current) as { events: AIProviderEvent[] };
}
afterEach(() => { for (const dispatcher of dispatchers.splice(0)) dispatcher.abort(); vi.useRealTimers(); });

describe('AI provider pull-stream lifecycle', () => {
  it('acknowledges start and delivers the first chunk before generation completes', async () => {
    const blocked = gate();
    let finished = false;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      await emit({ content: 'first', reasoningContent: 'thought' });
      await blocked.promise;
      await emit({ content: 'second' });
      finished = true;
      return { finishReason: 'stop' };
    });
    expect(await dispatcher.handle(wire('start'), signal())).toEqual({ accepted: true });
    expect(finished).toBe(false);
    expect(await pull(dispatcher)).toEqual({ events: [{ sequence: 1, type: 'delta', content: 'first', reasoningContent: 'thought' }] });
    blocked.release(); await flush();
    expect(await pull(dispatcher)).toEqual({ events: [{ sequence: 2, type: 'delta', content: 'second' }, { sequence: 3, type: 'done', finishReason: 'stop' }] });
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'invalid_request', data: { code: 'invalid_request' } });
  });

  it('keeps the worker alive after the start RPC context ends', async () => {
    const blocked = gate();
    let workerSignal: AbortSignal | undefined;
    const dispatcher = fixture(async (start, current, emit) => {
      workerSignal = current;
      expect(start.request.maxTokens).toBe(1024);
      await blocked.promise;
      await emit({ content: 'survived' });
      return { finishReason: 'stop' };
    });
    const rpc = new AbortController();
    await dispatcher.handle(wire('start'), rpc.signal);
    rpc.abort();
    expect(workerSignal).not.toBe(rpc.signal);
    expect(workerSignal?.aborted).toBe(false);
    blocked.release(); await flush();
    expect((await pull(dispatcher)).events.map((event) => event.type)).toEqual(['delta', 'done']);
  });

  it('holds a full-queue producer and releases it when the consumer drains', async () => {
    let emitted = 0;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      await emit({ content: 'one' }); emitted++;
      await emit({ content: 'two' }); emitted++;
      return { finishReason: 'stop' };
    }, { limits: { maxQueueEvents: 2 } });
    await dispatcher.handle(wire('start'), signal()); await flush();
    expect(emitted).toBe(1);
    expect((await pull(dispatcher)).events).toEqual([{ sequence: 1, type: 'delta', content: 'one' }]);
    await flush();
    expect(emitted).toBe(2);
    expect((await pull(dispatcher)).events).toEqual([{ sequence: 2, type: 'delta', content: 'two' }, { sequence: 3, type: 'done', finishReason: 'stop' }]);
  });

  it('cancels a blocked producer, clears its buffer, and fences late start', async () => {
    let emitted = 0;
    let rejection: unknown;
    const dispatcher = fixture(async (_start, _signal, emit) => {
      await emit({ content: 'one' }); emitted++;
      try { await emit({ content: 'two' }); emitted++; } catch (error: unknown) { rejection = error; }
      return { finishReason: 'stop' };
    }, { limits: { maxQueueEvents: 2 } });
    await dispatcher.handle(wire('start'), signal()); await flush();
    expect(emitted).toBe(1);
    expect(await dispatcher.handle(wire('cancel'), signal())).toEqual({ ok: true });
    await flush();
    expect(emitted).toBe(1);
    expect(rejection).toMatchObject({ message: 'canceled' });
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'canceled' });
    await expect(dispatcher.handle(wire('start'), signal())).rejects.toMatchObject({ message: 'canceled' });
  });

  it('fences unknown cancel before start and isolates every provider ID', async () => {
    let generated = 0;
    const dispatcher = fixture(async () => { generated++; return { finishReason: 'stop' }; });
    await dispatcher.handle(wire('cancel', 'late'), signal());
    await dispatcher.handle(wire('cancel', 'late'), signal());
    await expect(dispatcher.handle(wire('start', 'late'), signal())).rejects.toMatchObject({ message: 'canceled' });
    expect(generated).toBe(0);
    await expect(dispatcher.handle(wire('start', 'late', 'other'), signal())).resolves.toEqual({ accepted: true });
    await expect(dispatcher.handle(wire('pull', 'late', 'provider'), signal())).rejects.toMatchObject({ message: 'canceled' });
    await flush();
    expect(generated).toBe(1);
    await expect(pull(dispatcher, 'missing')).rejects.toMatchObject({ message: 'invalid_request' });
  });

});

describe('AI provider admission and consumers', () => {
  it('allows one waiting consumer, stops its wait at 1s, and obeys caller cancellation', async () => {
    vi.useFakeTimers();
    const blocked = gate();
    const dispatcher = fixture(async () => { await blocked.promise; return { finishReason: 'stop' }; });
    await dispatcher.handle(wire('start'), signal());
    let returned = false;
    const first = pull(dispatcher).then((value) => { returned = true; return value; });
    await expect(pull(dispatcher)).rejects.toMatchObject({ message: 'invalid_request' });
    await vi.advanceTimersByTimeAsync(999); expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await first).toEqual({ events: [] });
    const rpc = new AbortController();
    const canceled = pull(dispatcher, undefined, rpc.signal);
    const observed = expect(canceled).rejects.toMatchObject({ message: 'canceled' });
    rpc.abort(); await observed;
    expect(vi.getTimerCount()).toBe(2); // absolute deadline plus active idle lease
    blocked.release(); await dispatcher.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains all 16 slots for canceled callbacks until they actually finish', async () => {
    const blocked = Array.from({ length: 17 }, gate);
    let active = 0;
    let peak = 0;
    let aborted = 0;
    const dispatcher = fixture(async (start, current) => {
      active++; peak = Math.max(peak, active);
      current.addEventListener('abort', () => { aborted++; }, { once: true });
      await blocked[Number(start.requestId)].promise;
      active--; return { finishReason: 'stop' };
    });
    for (let index = 0; index < 16; index++) {
      await dispatcher.handle(wire('start', String(index)), signal());
      await dispatcher.handle(wire('cancel', String(index)), signal());
    }
    expect(active).toBe(16); expect(aborted).toBe(16);
    await expect(dispatcher.handle(wire('start', '16'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
    blocked[0].release(); await flush();
    expect(active).toBe(15);
    await dispatcher.handle(wire('start', '16'), signal());
    expect(active).toBe(16); expect(peak).toBe(16);
    for (const item of blocked) item.release();
    await dispatcher.close();
  });

  it('also bounds completed but unconsumed sessions at 16', async () => {
    const dispatcher = fixture();
    for (let index = 0; index < 16; index++) await dispatcher.handle(wire('start', String(index)), signal());
    await flush();
    await expect(dispatcher.handle(wire('start', 'overflow'), signal())).rejects.toMatchObject({ message: 'limit_exceeded' });
    expect((await pull(dispatcher, '0')).events).toEqual([{ sequence: 1, type: 'done', finishReason: 'stop' }]);
    await expect(dispatcher.handle(wire('start', 'new'), signal())).resolves.toEqual({ accepted: true });
    await expect(dispatcher.handle(wire('start', '0'), signal())).rejects.toMatchObject({ message: 'invalid_request' });
  });

});

describe('AI provider root and close', () => {
  it.each(['root', 'abort', 'close'])('wakes blocked pull and emit on %s and clears their timers', async (method) => {
    vi.useFakeTimers();
    const root = new AbortController();
    let stoppedEmit = false;
    const dispatcher = fixture(async (start, current, emit) => {
      if (start.requestId === 'producer') {
        await emit({ content: 'queued' });
        try { await emit({ content: 'blocked' }); } catch { stoppedEmit = true; }
      } else await new Promise<void>((resolve) => current.addEventListener('abort', () => resolve(), { once: true }));
      return { finishReason: 'stop' };
    }, { rootSignal: root.signal, limits: { maxQueueEvents: 2 } });
    await dispatcher.handle(wire('start', 'producer'), signal());
    await dispatcher.handle(wire('start', 'consumer'), signal()); await flush();
    const pending = pull(dispatcher, 'consumer');
    const observed = expect(pending).rejects.toMatchObject({ message: 'canceled' });
    if (method === 'root') root.abort();
    if (method === 'abort') dispatcher.abort();
    const closing = dispatcher.close();
    await observed; await closing;
    expect(stoppedEmit).toBe(true); expect(vi.getTimerCount()).toBe(0);
    await expect(dispatcher.handle(wire('start', 'new'), signal())).rejects.toMatchObject({ message: 'canceled' });
  });

  it('joins cooperatively and bounds close for an uncooperative callback', async () => {
    vi.useFakeTimers();
    const blocked = gate();
    const dispatcher = fixture(async () => { await blocked.promise; return { finishReason: 'stop' }; }, { limits: { closeWaitMs: 25 } });
    await dispatcher.handle(wire('start'), signal());
    let returned = false;
    const closing = dispatcher.close();
    closing.then(() => { returned = true; });
    expect(dispatcher.close()).toBe(closing);
    await vi.advanceTimersByTimeAsync(24); expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await closing; expect(returned).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    blocked.release(); await flush();
  });

  it('cancels a close join with its own signal without detaching extra worker tasks', async () => {
    vi.useFakeTimers();
    const blocked = gate();
    const dispatcher = fixture(async () => { await blocked.promise; return { finishReason: 'stop' }; });
    await dispatcher.handle(wire('start'), signal());
    const caller = new AbortController();
    const closing = dispatcher.close(caller.signal);
    caller.abort(); await closing;
    expect(vi.getTimerCount()).toBe(0);
    blocked.release(); await flush();
  });

  it('fails an expired stream explicitly and expires unconsumed completed output', async () => {
    vi.useFakeTimers();
    const dispatcher = fixture(async (_start, current) => {
      await new Promise<void>((resolve) => current.addEventListener('abort', () => resolve(), { once: true }));
      return { finishReason: 'stop' };
    }, { limits: { maxDurationMs: 20, retentionMs: 30 } });
    await dispatcher.handle(wire('start'), signal());
    const pending = expect(pull(dispatcher)).rejects.toMatchObject({ message: 'deadline' });
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    const completed = fixture(undefined, { limits: { retentionMs: 30 } });
    await completed.handle(wire('start'), signal()); await flush();
    await vi.advanceTimersByTimeAsync(30);
    await expect(pull(completed)).rejects.toMatchObject({ message: 'deadline' });
    await expect(completed.handle(wire('start'), signal())).rejects.toMatchObject({ message: 'deadline' });
    expect(vi.getTimerCount()).toBe(0);
  });

});

describe('AI provider cancellation boundaries', () => {
  it('rejects cancellation after a ready batch was read but before the pull reply settles', async () => {
    const dispatcher = fixture();
    await dispatcher.handle(wire('start'), signal()); await flush();
    const caller = new AbortController();
    const ready = pull(dispatcher, undefined, caller.signal);
    caller.abort();
    await expect(ready).rejects.toMatchObject({ message: 'canceled' });
    const other = fixture();
    await other.handle(wire('start'), signal()); await flush();
    const closing = pull(other);
    other.abort();
    await expect(closing).rejects.toMatchObject({ message: 'canceled' });
  });

  it('never starts a callback under an already canceled dispatcher root', async () => {
    const root = new AbortController(); root.abort();
    let generated = false;
    const dispatcher = fixture(async () => { generated = true; return { finishReason: 'stop' }; }, { rootSignal: root.signal });
    await expect(dispatcher.handle(wire('start'), signal())).rejects.toMatchObject({ message: 'canceled' });
    expect(generated).toBe(false);
    await dispatcher.close();
  });

  it('accepts abort as the Protocol onClose hook and never calls a model on the network', async () => {
    let current: AbortSignal | undefined;
    const dispatcher = fixture(async (_start, worker) => {
      current = worker;
      await new Promise<void>((resolve) => worker.addEventListener('abort', () => resolve(), { once: true }));
      return { finishReason: 'stop' };
    });
    const frames: string[] = [];
    const protocol = new Protocol({ handlers: { ai: dispatcher.handle }, send: (frame) => { frames.push(frame); }, onClose: dispatcher.abort });
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'plugin.initialize', params: {
      apiVersion: 1, pluginId: 'fixture', version: '1.0.0', generation: 1, config: {}, hostVersion: 'fixture', locale: 'en-US', permissions: ['ai.providers'],
    } }));
    await flush(); await protocol.flush();
    protocol.accept(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'plugin.invoke', params: { commandId: 'ai', arguments: wire('start') } }));
    await flush(); await protocol.flush();
    expect(JSON.parse(frames[1]).result).toEqual({ accepted: true });
    expect(current?.aborted).toBe(false);
    protocol.close(); await dispatcher.close();
    expect(current?.aborted).toBe(true);
  });
});
