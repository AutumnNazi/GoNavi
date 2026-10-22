import { ProtocolError } from './protocol.js';
import type { AIModel, JSONValue } from './types.js';
import { AI_PROVIDER_DEFAULT_LIMITS } from './aiproviderTypes.js';
import { AI_PROVIDER_IMAGE_MAX_REQUEST_BYTES, validateImages } from './aiproviderImages.js';
import type { AIProviderConfig, AIProviderControl, AIProviderErrorCode, AIProviderLimits, AIProviderMessage,
  AIProviderRegistration, AIProviderRequest, AIProviderStart, AIProviderTool } from './aiproviderTypes.js';

const encoder = new TextEncoder();
export class AIProviderFault extends Error {
  constructor(readonly kind: AIProviderErrorCode) { super(kind); }
}
export function fault(kind: AIProviderErrorCode): never { throw new AIProviderFault(kind); }
export function rpcFault(kind: AIProviderErrorCode): ProtocolError {
  const code = kind === 'canceled' ? -32800 : kind === 'invalid_request' ? -32602 : kind === 'unsupported' ? -32601 : -32000;
  return new ProtocolError(code, kind, { code: kind });
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function keys(value: unknown, allowed: readonly string[], required: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fault('invalid_request');
}
export function bytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).length; }
export function text(value: unknown, maxBytes: number, nonblank = false, allowNul = false): value is string {
  if (typeof value !== 'string' || value.length > maxBytes || (!allowNul && value.includes('\0')) || (nonblank && !value.trim())) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return encoder.encode(value).length <= maxBytes;
}
export function providerID(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64 && /^[a-z]/.test(value) && !/[^a-z0-9_.-]/.test(value);
}
export function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Snapshot only plain JSON, counting encoded bytes before constructing an unbounded serialized tree. */
export function boundedJSON(input: unknown, maxBytes: number, kind: AIProviderErrorCode = 'invalid_request'): JSONValue {
  let used = 0;
  let nodes = 0;
  const charge = (size: number) => { used += size; if (used > maxBytes) fault('limit_exceeded'); };
  const visit = (value: unknown, depth: number): JSONValue => {
    if (++nodes > 32768 || depth > 32) fault('limit_exceeded');
    if (value === null || typeof value === 'boolean') { charge(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === 'string') {
      if (value.length > maxBytes) fault('limit_exceeded');
      if (!text(value, maxBytes, false, true)) fault(kind);
      charge(bytes(value)); return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(String(value).length); return value;
    }
    if (Array.isArray(value)) {
      charge(2 + Math.max(0, value.length - 1));
      if (value.length > 32768) fault('limit_exceeded');
      return Array.from(value, (item) => visit(item, depth + 1));
    }
    if (!record(value) || Object.getOwnPropertySymbols(value).length) fault(kind);
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (entries.length > 32768) fault('limit_exceeded');
    charge(2 + Math.max(0, entries.length - 1));
    return Object.fromEntries(entries.map(([key, descriptor]) => {
      if (++nodes > 32768) fault('limit_exceeded');
      if (!('value' in descriptor) || !descriptor.enumerable || !text(key, maxBytes, false, true)) fault(kind);
      charge(bytes(key) + 1);
      return [key, visit(descriptor.value, depth + 1)];
    }));
  };
  return visit(input, 0);
}

export function resolveLimits(input: Partial<AIProviderLimits> | undefined): Readonly<AIProviderLimits> {
  if (input !== undefined && !record(input)) fault('invalid_request');
  const result = { ...AI_PROVIDER_DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!Object.hasOwn(result, key)) fault('invalid_request');
    const name = key as keyof AIProviderLimits;
    if (!integer(value, 1, result[name])) fault('invalid_request');
    result[name] = value;
  }
  if (result.maxEventBytes < 128 || result.maxPullBytes < result.maxEventBytes + 13 ||
      result.maxQueueEvents < 2 || result.maxQueueBytes <= result.maxEventBytes ||
      result.maxCompletionEvents < 2 || result.maxCompletionBytes <= result.maxEventBytes) fault('invalid_request');
  return Object.freeze(result);
}

export function registration(input: AIProviderRegistration): AIProviderRegistration {
  if (!record(input) || typeof input.supportsTools !== 'boolean' || typeof input.supportsImages !== 'boolean' || typeof input.generate !== 'function' ||
      !Array.isArray(input.models) || input.models.length < 1 || input.models.length > 32) fault('invalid_request');
  const ids = new Set<string>();
  const models = input.models.map((model: Readonly<AIModel>) => {
    keys(model, ['id', 'name', 'contextWindow', 'maxOutputTokens'], ['id', 'name', 'contextWindow', 'maxOutputTokens']);
    if (typeof model.id !== 'string' || model.id.length > 128 || !/^[A-Za-z0-9]/.test(model.id) || /[^A-Za-z0-9_.:/@+-]/.test(model.id) || ids.has(model.id) ||
        !text(model.name, 256, true) || !integer(model.contextWindow, 1024, 262144) ||
        !integer(model.maxOutputTokens, 1, Math.min(65536, model.contextWindow))) fault('invalid_request');
    ids.add(model.id);
    return Object.freeze({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens });
  });
  return Object.freeze({ models: Object.freeze(models), supportsTools: input.supportsTools, supportsImages: input.supportsImages, generate: input.generate });
}

export function envelope(input: JSONValue, limits: Readonly<AIProviderLimits>): Record<string, unknown> {
  // Image starts can be far larger than a text request; text-only ones are narrowed back in start().
  const value = boundedJSON(input, Math.max(limits.maxRequestBytes, AI_PROVIDER_IMAGE_MAX_REQUEST_BYTES));
  keys(value, ['protocolVersion', 'operation', 'providerId', 'requestId', 'config', 'request'], ['protocolVersion', 'operation', 'providerId', 'requestId']);
  if (value.protocolVersion !== 1 || typeof value.operation !== 'string' || !['start', 'pull', 'cancel'].includes(value.operation)) fault('unsupported');
  if (!providerID(value.providerId) || typeof value.requestId !== 'string' || value.requestId.length < 1 || value.requestId.length > 128 || /[^A-Za-z0-9_-]/.test(value.requestId)) fault('invalid_request');
  if (value.operation === 'start') {
    if (!Object.hasOwn(value, 'config') || !Object.hasOwn(value, 'request')) fault('invalid_request');
  } else if (Object.hasOwn(value, 'config') || Object.hasOwn(value, 'request')) fault('invalid_request');
  return value;
}

export function control(value: Record<string, unknown>): AIProviderControl {
  return { protocolVersion: 1, operation: value.operation as 'pull' | 'cancel', providerId: value.providerId as string, requestId: value.requestId as string };
}

function headers(value: unknown): Record<string, string> {
  if (!record(value) || Object.keys(value).length > 32) fault('invalid_request');
  const names = new Set<string>();
  let size = 0;
  const forbidden = ['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization'];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const name = key.toLowerCase();
    if (key.length < 1 || key.length > 128 || /[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(key) || names.has(name) || forbidden.includes(name) ||
        !text(item, 4096) || /[\r\n]/.test(item)) fault('invalid_request');
    names.add(name); size += encoder.encode(key).length + encoder.encode(item).length;
    if (size > 16 * 1024) fault('limit_exceeded');
    return [key, item];
  }));
}

function config(value: unknown, models: readonly Readonly<AIModel>[]): AIProviderConfig {
  keys(value, ['baseUrl', 'apiKey', 'model', 'headers'], ['baseUrl', 'apiKey', 'model']);
  if (!text(value.baseUrl, 4096) || !text(value.apiKey, 16 * 1024) || !text(value.model, 128, true) || !models.some((model) => model.id === value.model)) fault('invalid_request');
  if (value.baseUrl) {
    if (!/^https?:\/\//i.test(value.baseUrl) || /[\u0000-\u0020\u007f]/.test(value.baseUrl) || /^https?:\/\/[^/?#]*@/i.test(value.baseUrl)) fault('invalid_request');
    try {
      const url = new URL(value.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) fault('invalid_request');
    } catch { fault('invalid_request'); }
  }
  return { baseUrl: value.baseUrl, apiKey: value.apiKey, model: value.model, ...('headers' in value ? { headers: headers(value.headers) } : {}) };
}

function tools(value: unknown, supported: boolean): AIProviderTool[] {
  if (!Array.isArray(value) || value.length > 128) fault('invalid_request');
  if (value.length && !supported) fault('unsupported');
  const names = new Set<string>();
  return value.map((tool) => {
    keys(tool, ['type', 'function'], ['type', 'function']);
    keys(tool.function, ['name', 'description', 'parameters'], ['name', 'description', 'parameters']);
    const fn = tool.function;
    if (tool.type !== 'function' || !text(fn.name, 128, true) || names.has(fn.name) ||
        !text(fn.description, 512 * 1024, false, true) || !record(fn.parameters)) fault('invalid_request');
    names.add(fn.name);
    return { type: 'function', function: { name: fn.name, description: fn.description, parameters: fn.parameters as Record<string, JSONValue> } };
  });
}

// Request history is independently checked; offered-name validation applies to new completion calls.
export function toolCalls(value: unknown, offered?: ReadonlySet<string>): import('./aiproviderTypes.js').AIProviderToolCall[] {
  if (!Array.isArray(value)) fault('invalid_request');
  if (value.length > 64) fault('limit_exceeded');
  if (bytes(value) > 48 * 1024) fault('limit_exceeded');
  const ids = new Set<string>();
  return value.map((call) => {
    keys(call, ['id', 'type', 'function'], ['id', 'type', 'function']);
    keys(call.function, ['name', 'arguments'], ['name', 'arguments']);
    const fn = call.function;
    if (!text(call.id, 128, true) || ids.has(call.id) || call.type !== 'function' || !text(fn.name, 128, true) ||
        (offered && !offered.has(fn.name)) || !text(fn.arguments, 48 * 1024)) fault('invalid_request');
    if (encoder.encode(fn.arguments).length > 32 * 1024) fault('limit_exceeded');
    argumentsObject(fn.arguments);
    ids.add(call.id);
    return { id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } };
  });
}

function argumentsObject(input: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { fault('invalid_request'); }
  if (!record(boundedJSON(parsed, 32 * 1024))) fault('invalid_request');
  // JSON.parse alone discards duplicate keys, including escaped aliases. The string is still available here.
  const stack: (Set<string> | undefined)[] = [];
  for (let offset = 0; offset < input.length; offset++) {
    const token = input[offset];
    if (token === '{' || token === '[') stack.push(token === '{' ? new Set() : undefined);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === '"') {
      const begin = offset++;
      while (offset < input.length && input[offset] !== '"') offset += input[offset] === '\\' ? 2 : 1;
      let next = offset + 1;
      while (next < input.length && /\s/.test(input[next])) next++;
      const names = stack[stack.length - 1];
      if (input[next] !== ':' || !names) continue;
      const name = JSON.parse(input.slice(begin, offset + 1)) as string;
      if (names.has(name)) fault('invalid_request');
      names.add(name);
    }
  }
}

function messages(value: unknown, supportsImages: boolean): AIProviderMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 512) fault('invalid_request');
  const parsed = value.map((message) => {
    keys(message, ['role', 'content', 'reasoning_content', 'tool_call_id', 'tool_calls', 'images'], ['role', 'content']);
    if (typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role) || !text(message.content, 512 * 1024, false, true)) fault('invalid_request');
    if ('reasoning_content' in message && !text(message.reasoning_content, 512 * 1024, false, true)) fault('invalid_request');
    if (message.role === 'tool' && !('tool_call_id' in message)) fault('invalid_request');
    if ('tool_call_id' in message && (message.role !== 'tool' || !text(message.tool_call_id, 128, true))) fault('invalid_request');
    if ('tool_calls' in message && message.role !== 'assistant') fault('invalid_request');
    if ('images' in message && (!Array.isArray(message.images) || message.images.length < 1 || message.images.length > 4 || message.images.some((item) => typeof item !== 'string'))) fault('invalid_request');
    return { role: message.role as AIProviderMessage['role'], content: message.content,
      ...('reasoning_content' in message ? { reasoning_content: message.reasoning_content as string } : {}),
      ...('tool_call_id' in message ? { tool_call_id: message.tool_call_id as string } : {}),
      ...('tool_calls' in message ? { tool_calls: toolCalls(message.tool_calls) } : {}),
      ...('images' in message ? { images: [...(message.images as string[])] } : {}) };
  });
  validateImages(parsed, supportsImages);
  return parsed;
}

export function start(value: Record<string, unknown>, provider: AIProviderRegistration): AIProviderStart {
  const selected = config(value.config, provider.models);
  keys(value.request, ['messages', 'temperature', 'maxTokens', 'tools'], ['messages', 'temperature', 'maxTokens']);
  const input = value.request;
  const max = provider.models.find((model) => model.id === selected.model)!.maxOutputTokens;
  if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2 || !integer(input.maxTokens, 0, max)) fault('invalid_request');
  const request: AIProviderRequest = { messages: messages(input.messages, provider.supportsImages), temperature: input.temperature, maxTokens: input.maxTokens || max,
    ...('tools' in input ? { tools: tools(input.tools, provider.supportsTools) } : {}) };
  const hasImages = request.messages.some((message) => (message.images?.length ?? 0) > 0);
  if (!hasImages && bytes(request) > AI_PROVIDER_DEFAULT_LIMITS.maxRequestBytes) fault('limit_exceeded');
  return { protocolVersion: 1, operation: 'start', providerId: value.providerId as string, requestId: value.requestId as string, config: selected, request };
}
