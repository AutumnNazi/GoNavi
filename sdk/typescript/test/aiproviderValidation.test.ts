import { afterEach, describe, expect, it } from 'vitest';
import { AIProviderDispatcher } from '../src/aiprovider.js';
import type { AIProviderCompletion, AIProviderRegistration, AIProviderLifecycleOptions, AIProviderEvent, AIProviderStart } from '../src/aiprovider.js';
import { ProtocolError } from '../src/protocol.js';
import type { JSONValue } from '../src/types.js';

const models = [{ id: 'fixture', name: 'Fixture', contextWindow: 4096, maxOutputTokens: 1024 }];
const signal = () => new AbortController().signal;
const dispatchers: AIProviderDispatcher[] = [];
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const wire = () => ({ protocolVersion: 1, operation: 'start', providerId: 'provider', requestId: 'A'.repeat(43),
  config: { baseUrl: '', apiKey: 'fixture-secret', model: 'fixture' },
  request: { messages: [{ role: 'user', content: 'fixture' }], temperature: 0.5, maxTokens: 0 },
});
const withConfig = (value: Record<string, unknown>) => ({ ...wire(), config: { ...wire().config, ...value } });
const withRequest = (value: Record<string, unknown>) => ({ ...wire(), request: { ...wire().request, ...value } });
const offered = { type: 'function', function: { name: 'lookup', description: '', parameters: { type: 'object', properties: {} } } };
const call = (id = 'call-1', name = 'lookup', args = '{"city":"fixture"}') => ({ id, type: 'function', function: { name, arguments: args } });
function fixture(value: unknown = { finishReason: 'stop' }, options: Partial<AIProviderRegistration> & AIProviderLifecycleOptions & { providerId?: string } = {}) {
  const { limits, rootSignal, providerId, ...overrides } = options;
  const registration = { models, supportsTools: true, supportsImages: false, generate: async () => value as AIProviderCompletion, ...overrides };
  const providers = providerId ? { [providerId]: registration } : { provider: registration, other: registration };
  const dispatcher = new AIProviderDispatcher({ providers, limits, rootSignal });
  dispatchers.push(dispatcher); return dispatcher;
}
async function invoke(dispatcher: AIProviderDispatcher, value: unknown) { return dispatcher.handle(value as JSONValue, signal()); }
async function events(dispatcher: AIProviderDispatcher, value: unknown = wire()): Promise<AIProviderEvent[]> {
  await invoke(dispatcher, value); await flush();
  const result = await invoke(dispatcher, { protocolVersion: 1, operation: 'pull', providerId: 'provider', requestId: 'A'.repeat(43) });
  return (result as { events: AIProviderEvent[] }).events;
}
afterEach(() => { for (const dispatcher of dispatchers.splice(0)) dispatcher.abort(); });

describe('AI provider request boundary', () => {
  it.each([
    null, [], {}, { ...wire(), protocolVersion: 2 }, { ...wire(), operation: null }, { ...wire(), operation: ['start'] },
    { ...wire(), operation: 'replay' }, { ...wire(), providerId: 'Provider' }, { ...wire(), providerId: 'provider\n' },
    { ...wire(), requestId: '' }, { ...wire(), requestId: null }, { ...wire(), requestId: '../bad' }, { ...wire(), requestId: 'valid\n' },
    { ...wire(), requestId: 'A'.repeat(129) }, { ...wire(), config: null }, { ...wire(), request: null },
    { ...wire(), images: [] }, { ...wire(), state: {} }, { ...wire(), operation: 'pull' }, { ...wire(), operation: 'cancel' },
    { ...wire(), config: { apiKey: '', model: 'fixture' } }, { ...wire(), request: { messages: [] } },
  ])('rejects invalid envelopes without invoking generation %#', async (value) => {
    let generated = false;
    const dispatcher = fixture(undefined, { generate: async () => { generated = true; return { finishReason: 'stop' }; } });
    await expect(invoke(dispatcher, value)).rejects.toBeInstanceOf(ProtocolError);
    expect(generated).toBe(false);
  });

  it.each([
    withConfig({ baseUrl: null }), withConfig({ apiKey: null }), withConfig({ model: null }), withConfig({ headers: null }),
    withConfig({ apiKey: 'a'.repeat(16385) }), withConfig({ apiKey: '密'.repeat(5462) }), withConfig({ apiKey: '\0' }),
    withConfig({ apiKey: '\ud800' }), withConfig({ baseUrl: 'x'.repeat(4097) }), withConfig({ baseUrl: 'file:///tmp/a' }),
    withConfig({ baseUrl: 'https://' }), withConfig({ baseUrl: 'http:example.invalid' }), withConfig({ baseUrl: ' http://example.invalid' }),
    withConfig({ baseUrl: 'https://user:password@example.invalid' }), withConfig({ baseUrl: 'http://@example.invalid' }),
    withConfig({ baseUrl: 'https://example.invalid/\n' }), withConfig({ model: 'Fixture' }), withConfig({ model: 'fixture ' }),
    withConfig({ model: 'a'.repeat(129) }), withConfig({ secretRef: 'foreign' }), withConfig({ apiFormat: 'openai' }),
    withConfig({ cliEnv: {} }), withConfig({ supportsImages: false }), withConfig({ thinkingIntensity: '' }),
    withConfig({ headers: { Host: 'example.invalid' } }), withConfig({ headers: { 'CONTENT-LENGTH': '1' } }),
    withConfig({ headers: { Connection: 'keep-alive' } }), withConfig({ headers: { 'Transfer-Encoding': 'chunked' } }),
    withConfig({ headers: { Upgrade: 'ws' } }), withConfig({ headers: { 'Proxy-Authorization': 'secret' } }),
    withConfig({ headers: { Accept: 'a', accept: 'b' } }), withConfig({ headers: { 'bad name': 'x' } }),
    withConfig({ headers: { 'valid\n': 'x' } }), withConfig({ headers: { ['A'.repeat(129)]: 'x' } }),
    withConfig({ headers: { x: 'a\rb' } }), withConfig({ headers: { x: 'a\nb' } }), withConfig({ headers: { x: 'a\0b' } }),
    withConfig({ headers: { x: null } }), withConfig({ headers: { x: 'a'.repeat(4097) } }),
    withConfig({ headers: Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['x' + index, 'v'])) }),
    withConfig({ headers: Object.fromEntries(Array.from({ length: 5 }, (_, index) => ['x' + index, 'v'.repeat(4096)])) }),
  ])('rejects unsafe selected configuration %#', async (value) => {
    await expect(invoke(fixture(), value)).rejects.toBeInstanceOf(ProtocolError);
  });

  it.each([
    withRequest({ messages: null }), withRequest({ messages: [] }), withRequest({ messages: Array.from({ length: 513 }, () => ({ role: 'user', content: '' })) }),
    withRequest({ messages: [{ role: 'developer', content: '' }] }), withRequest({ messages: [{ role: ['user'], content: '' }] }),
    withRequest({ messages: [{ role: 'user', content: null }] }), withRequest({ messages: [{ role: 'user', content: '', images: [] }] }),
    withRequest({ messages: [{ role: 'assistant', content: '', reasoningContent: 'camelCase' }] }),
    withRequest({ messages: [{ role: 'assistant', content: '', reasoning_content: null }] }),
    withRequest({ messages: [{ role: 'tool', content: '' }] }), withRequest({ messages: [{ role: 'tool', content: '', tool_call_id: null }] }),
    withRequest({ messages: [{ role: 'user', content: '', tool_call_id: 'wrong-role' }] }),
    withRequest({ messages: [{ role: 'assistant', content: '', tool_calls: null }] }),
    withRequest({ temperature: null }), withRequest({ temperature: NaN }), withRequest({ temperature: Infinity }),
    withRequest({ temperature: -0.1 }), withRequest({ temperature: 2.1 }), withRequest({ maxTokens: null }),
    withRequest({ maxTokens: -1 }), withRequest({ maxTokens: 0.1 }), withRequest({ maxTokens: 1025 }),
    withRequest({ tools: null }), withRequest({ tools: Array.from({ length: 129 }, () => offered) }),
    withRequest({ tools: [offered, offered] }), withRequest({ tools: [{ ...offered, type: 'other' }] }),
    withRequest({ tools: [{ type: 'function', name: 'flat', parameters: {} }] }),
    withRequest({ tools: [{ type: 'function', function: { name: 'lookup', description: '', parameters: null } }] }),
    withRequest({ tools: [{ type: 'function', function: { name: 'lookup', parameters: {} } }] }),
  ])('rejects null tricks, foreign fields and invalid request bounds %#', async (value) => {
    await expect(invoke(fixture(), value)).rejects.toBeInstanceOf(ProtocolError);
  });

});

describe('AI provider request snapshots and budgets', () => {
  it('accepts exact snake_case history, UTF-8 credentials, and zero/default or explicit token limits', async () => {
    const captured: AIProviderStart[] = [];
    const dispatcher = fixture(undefined, { generate: async (value) => { captured.push(value); return { finishReason: 'stop' }; } });
    const input = { ...wire(), config: { baseUrl: 'https://[::1]:443/v1', apiKey: '密'.repeat(5461) + 'a', model: 'fixture', headers: { Authorization: 'fixture', 'X-Local': '值' } },
      request: { messages: [{ role: 'assistant', content: '', reasoning_content: 'thought', tool_calls: [call()] },
        { role: 'tool', content: 'result', tool_call_id: 'call-1' }], temperature: 2, maxTokens: 0, tools: [offered] } };
    await events(dispatcher, input);
    expect(captured[0].request.messages).toEqual(input.request.messages);
    expect(captured[0].config).toEqual(input.config);
    expect(captured[0].request.maxTokens).toBe(1024);
    await invoke(dispatcher, { ...input, requestId: 'explicit', request: { ...input.request, maxTokens: 1 } }); await flush();
    expect(captured[1].request.maxTokens).toBe(1);
  });

  it('accepts the SDK token range including the host 43-character base64url shape', async () => {
    const dispatcher = fixture();
    for (const requestId of ['a', 'A'.repeat(43), '_-'.repeat(64)]) {
      await expect(invoke(dispatcher, { ...wire(), requestId })).resolves.toEqual({ accepted: true });
    }
  });

  it('snapshots declarations and request input instead of trusting later mutations', async () => {
    const declarations = models.map((value) => ({ ...value }));
    const observed: AIProviderStart[] = [];
    const options = { models: declarations, supportsTools: false, supportsImages: false, generate: async (value: AIProviderStart) => { observed.push(value); return { finishReason: 'stop' as const }; } };
    const dispatcher = new AIProviderDispatcher({ providers: { provider: options } }); dispatchers.push(dispatcher);
    declarations[0].maxOutputTokens = 1; declarations[0].id = 'changed';
    options.generate = async () => { throw new Error('mutated callback'); };
    const input = wire();
    const admitted = invoke(dispatcher, input);
    input.config.apiKey = 'mutated'; input.request.messages[0].content = 'mutated';
    await admitted; await flush();
    expect(observed[0].config.apiKey).toBe('fixture-secret');
    expect(observed[0].request.messages[0].content).toBe('fixture');
    expect(observed[0].request.maxTokens).toBe(1024);
  });

  it('bounds encoded request bytes, JSON depth and nodes before admission', async () => {
    const dispatcher = fixture();
    await expect(invoke(dispatcher, withRequest({ messages: [{ role: 'user', content: 'x'.repeat(512 * 1024) }] }))).rejects.toMatchObject({ message: 'limit_exceeded' });
    let nested: JSONValue = {};
    for (let index = 0; index < 33; index++) nested = { inner: nested };
    await expect(invoke(dispatcher, withRequest({ tools: [{ ...offered, function: { ...offered.function, parameters: nested } }] }))).rejects.toMatchObject({ message: 'limit_exceeded' });
    await expect(invoke(dispatcher, withRequest({ tools: [{ ...offered, function: { ...offered.function, parameters: { enum: Array(32768).fill(null) } } }] }))).rejects.toMatchObject({ message: 'limit_exceeded' });
    const manyKeys = Object.fromEntries(Array.from({ length: 16400 }, (_, index) => ['k' + index, null]));
    await expect(invoke(dispatcher, withRequest({ tools: [{ ...offered, function: { ...offered.function, parameters: manyKeys } }] }))).rejects.toMatchObject({ message: 'limit_exceeded' });
  });

  it('preserves arbitrary valid text including NUL while credential fields reject NUL', async () => {
    const observed: string[] = [];
    const dispatcher = fixture(undefined, { generate: async (start, _signal, emit) => {
      observed.push(start.request.messages[0].content);
      await emit({ content: 'response\0text' }); return { finishReason: 'stop' };
    } });
    expect(await events(dispatcher, withRequest({ messages: [{ role: 'user', content: 'input\0text' }] }))).toEqual([
      { sequence: 1, type: 'delta', content: 'response\0text' }, { sequence: 2, type: 'done', finishReason: 'stop' },
    ]);
    expect(observed).toEqual(['input\0text']);
  });

  it('rejects unsupported tools and pre-canceled start without running any callback', async () => {
    let calls = 0;
    const dispatcher = fixture(undefined, { supportsTools: false, supportsImages: false, generate: async () => { calls++; return { finishReason: 'stop' }; } });
    await expect(invoke(dispatcher, withRequest({ tools: [offered] }))).rejects.toMatchObject({ message: 'unsupported' });
    const canceled = new AbortController(); canceled.abort();
    await expect(dispatcher.handle(wire(), canceled.signal)).rejects.toMatchObject({ message: 'canceled' });
    expect(calls).toBe(0);
  });
});

describe('AI provider terminal validation and safe failures', () => {
  it('returns complete function snapshots, camelCase usage, and explicit length completion', async () => {
    const usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3, cachedTokens: 0 };
    expect(await events(fixture({ finishReason: 'tool_calls', toolCalls: [call()], usage }), withRequest({ tools: [offered] }))).toEqual([
      { sequence: 1, type: 'done', finishReason: 'tool_calls', toolCalls: [call()], usage },
    ]);
    expect(await events(fixture({ finishReason: 'length' }))).toEqual([{ sequence: 1, type: 'done', finishReason: 'length' }]);
  });

  it('accepts nested argument objects, escaped string delimiters and large finite schema numbers', async () => {
    const args = JSON.stringify({ a: ['{', '[', ':', '"', '\\', '}'], b: { x: 1 }, c: { x: 2 } });
    const value = { finishReason: 'tool_calls', toolCalls: [call('x', 'lookup', args)] };
    const tool = { ...offered, function: { ...offered.function, parameters: { type: 'object', maximum: 1e80 } } };
    expect(await events(fixture(value), withRequest({ tools: [tool] }))).toEqual([{ sequence: 1, type: 'done', ...value }]);
  });

  it.each([
    null, {}, { finishReason: null }, { finishReason: 'other' }, { finishReason: 'stop', extra: 'foreign' },
    { finishReason: 'tool_calls' }, { finishReason: 'tool_calls', toolCalls: [] }, { finishReason: 'stop', toolCalls: [call()] },
    { finishReason: 'tool_calls', toolCalls: null }, { finishReason: 'tool_calls', toolCalls: [call('x', 'unoffered')] },
    { finishReason: 'tool_calls', toolCalls: [call('x'), call('x')] },
    ...['{', '[]', 'null', '1', '"value"', '{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"a":{"x":1,"x":2}}'].map((args) => ({ finishReason: 'tool_calls', toolCalls: [call('x', 'lookup', args)] })),
    { finishReason: 'tool_calls', toolCalls: [{ ...call(), type: 'not-function' }] },
    { finishReason: 'tool_calls', toolCalls: [{ ...call(), id: '' }] },
    { finishReason: 'tool_calls', toolCalls: [{ ...call(), function: { name: 'lookup', arguments: {} } }] },
    { finishReason: 'stop', usage: null }, { finishReason: 'stop', usage: {} },
    ...[null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => ['promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens'].map((field) =>
      ({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, [field]: value } }))),
    { finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, prompt_tokens: 0 } },
  ])('turns malformed completion into one safe error terminal %#', async (value) => {
    expect(await events(fixture(value), withRequest({ tools: [offered] }))).toEqual([{ sequence: 1, type: 'error', code: 'generation_failed' }]);
  });

  it('allows safe-integer usage maxima and rejects tools on text-only providers', async () => {
    const usage = { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: Number.MAX_SAFE_INTEGER, totalTokens: Number.MAX_SAFE_INTEGER };
    expect(await events(fixture({ finishReason: 'stop', usage }))).toEqual([{ sequence: 1, type: 'done', finishReason: 'stop', usage }]);
    expect(await events(fixture({ finishReason: 'tool_calls', toolCalls: [call()] }, { supportsTools: false }))).toEqual([{ sequence: 1, type: 'error', code: 'unsupported' }]);
  });

  it('sanitizes raw upstream failures, including explicitly public ProtocolError messages', async () => {
    for (const failure of [new Error('secret=credential upstream stack'), new ProtocolError(-32602, 'secret=credential'), { message: 'secret=credential' }]) {
      const dispatcher = fixture(undefined, { generate: async (_start, _signal, emit) => { await emit({ content: 'partial' }); throw failure; } });
      const result = await events(dispatcher);
      expect(result).toEqual([{ sequence: 1, type: 'delta', content: 'partial' }, { sequence: 2, type: 'error', code: 'generation_failed' }]);
      expect(JSON.stringify(result)).not.toContain('credential');
    }
  });

  it.each([null, {}, { content: '' }, { content: null }, { content: 'x', extra: true }, { reasoning_content: 'snake' }])('rejects malformed emitted data %#', async (value) => {
    const dispatcher = fixture(undefined, { generate: async (_start, _signal, emit) => { await emit(value as { content: string }); return { finishReason: 'stop' }; } });
    expect(await events(dispatcher)).toEqual([{ sequence: 1, type: 'error', code: 'generation_failed' }]);
  });

  it('keeps exactly one terminal and contiguous accepted sequences when oversize emit is caught', async () => {
    const rejected: unknown[] = [];
    const dispatcher = fixture(undefined, { generate: async (_start, _signal, emit) => {
      await emit({ content: 'accepted' });
      try { await emit({ content: 'x'.repeat(64 * 1024) }); } catch (error: unknown) { rejected.push(error); }
      try { await emit({ content: 'late' }); } catch (error: unknown) { rejected.push(error); }
      return { finishReason: 'stop' };
    } });
    expect(await events(dispatcher)).toEqual([{ sequence: 1, type: 'delta', content: 'accepted' }, { sequence: 2, type: 'error', code: 'limit_exceeded' }]);
    expect(rejected).toHaveLength(2);
  });

  it('bounds terminal argument bytes, total tool JSON and call count without truncation', async () => {
    const outputs = [
      { finishReason: 'tool_calls', toolCalls: [call('x', 'lookup', JSON.stringify({ x: 'x'.repeat(32768) }))] },
      { finishReason: 'tool_calls', toolCalls: [call('x', 'lookup', JSON.stringify({ x: 'x'.repeat(26000) })), call('y', 'lookup', JSON.stringify({ x: 'x'.repeat(26000) }))] },
    ];
    for (const value of outputs) expect(await events(fixture(value), withRequest({ tools: [offered] }))).toEqual([{ sequence: 1, type: 'error', code: 'limit_exceeded' }]);
    const tooMany = { finishReason: 'tool_calls', toolCalls: Array.from({ length: 65 }, (_, index) => call('id-' + index)) };
    expect(await events(fixture(tooMany), withRequest({ tools: [offered] }))).toEqual([{ sequence: 1, type: 'error', code: 'limit_exceeded' }]);
  });

  it('does not execute getters or expose their exception contents', async () => {
    const malicious = Object.defineProperty({}, 'finishReason', { enumerable: true, get() { throw new Error('credential'); } });
    expect(await events(fixture(malicious))).toEqual([{ sequence: 1, type: 'error', code: 'generation_failed' }]);
  });
});
