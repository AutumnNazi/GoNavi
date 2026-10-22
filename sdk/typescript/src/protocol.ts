import { DEFAULT_MAX_FRAME_BYTES } from './framing.js';
import type { InitializeParams, JSONValue, RequestID, RPCError, RPCResponse } from './types.js';

/** Handlers must yield during async work and pass signal to fetch/other I/O.
 * CPU-bound JavaScript belongs in a Worker; promises do not isolate CPU loops. */
export type Handler = ((argumentsValue: JSONValue, signal: AbortSignal) => JSONValue | Promise<JSONValue>) & {
  /** Optional strict preflight of the original invocation; ordinary handlers are unchanged. */
  validateInvokeFrame?: (frame: string) => void;
};
export interface ProtocolOptions {
  handlers: Readonly<Record<string, Handler>>;
  send: (frame: string) => void | Promise<void>;
  initialize?: (params: InitializeParams, signal: AbortSignal) => void | Promise<void>;
  onClose?: () => void;
  onLifecycle?: (event: { event: 'running'; generation: number }) => void;
  onFatal?: (error: Error) => void;
  maxConcurrent?: number;
  maxFrameBytes?: number;
}

/** An explicitly public error; ordinary exception messages are not sent to the host. */
export class ProtocolError extends Error implements RPCError {
  constructor(readonly code: number, message: string, readonly data?: JSONValue) { super(message); }
}

const encoder = new TextEncoder();
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validID(value: unknown): value is RequestID {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}
function isInitializeParams(value: unknown): value is InitializeParams {
  return record(value) && value.apiVersion === 1 && typeof value.pluginId === 'string' && value.pluginId.length > 0 &&
    typeof value.version === 'string' && typeof value.generation === 'number' && Number.isSafeInteger(value.generation) &&
    value.generation >= 0 && record(value.config) && typeof value.hostVersion === 'string' && typeof value.locale === 'string' &&
    Array.isArray(value.permissions) && value.permissions.every((permission: unknown) => typeof permission === 'string');
}
function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid protocol limit');
  return value;
}

/** One host connection. accept never waits for an outstanding handler. */
export class Protocol {
  private readonly handlers: Readonly<Record<string, Handler>>;
  private readonly active = new Map<RequestID, AbortController>();
  private readonly maxConcurrent: number;
  private readonly maxFrameBytes: number;
  private initialized = false;
  private initializing = false;
  private closed = false;
  private rootsClosed = false;
  private stopping = false;
  private queued = 0;
  private output = Promise.resolve();
  private hostSeq = 0;
  private readonly hostPending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();

  constructor(private readonly options: ProtocolOptions) {
    this.handlers = { ...options.handlers };
    this.maxConcurrent = positiveLimit(options.maxConcurrent, 32);
    this.maxFrameBytes = positiveLimit(options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES);
  }

  accept(frame: string): void {
    if (this.closed || this.stopping) return;
    if (encoder.encode(frame).length > this.maxFrameBytes) { this.fatal(new Error('request exceeds frame limit')); return; }
    let message: unknown;
    try { message = JSON.parse(frame); }
    catch { this.reply(null, undefined, new ProtocolError(-32700, 'invalid JSON')); return; }
    if (this.deliverHostResponse(message)) return;
    if (!record(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        ('id' in message && !validID(message.id))) {
      this.reply(null, undefined, new ProtocolError(-32600, 'invalid request')); return;
    }
    if (message.method === 'plugin.lifecycle' && !('id' in message)) { this.deliverLifecycle(message.params); return; }
    if (message.method === '$/cancelRequest') {
      if (record(message.params) && validID(message.params.id)) this.active.get(message.params.id)?.abort();
      return;
    }
    if (!validID(message.id)) return;
    const id = message.id;
    switch (message.method) {
      case 'plugin.ping': this.reply(id, {}); return;
      case 'plugin.shutdown': this.shutdown(id); return;
      case 'plugin.initialize': this.initialize(id, message.params); return;
      case 'plugin.invoke': this.invoke(id, message.params, frame); return;
      default: this.reply(id, undefined, new ProtocolError(-32601, 'method not found'));
    }
  }

  /** Call on EOF, transport failure or lifecycle cancellation. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    for (const pending of this.hostPending.values()) pending.reject(new ProtocolError(-32800, 'request cancelled'));
    this.hostPending.clear();
    this.closeRoots();
  }

  /** Resolves after currently queued writes, not after user handlers. */
  flush(): Promise<void> { return this.output; }

  /** Log sends one bounded diagnostic and waits for the host object result. */
  log(level: string, message: string, signal?: AbortSignal): Promise<void> {
    if (level !== 'info' && level !== 'warn') return Promise.reject(new ProtocolError(-32602, 'host log level must be info or warn'));
    if (typeof message !== 'string' || message.length === 0 || message.includes('\0') || encoder.encode(message).length > 1024) {
      return Promise.reject(new ProtocolError(-32602, 'host log message is empty, too long, or not valid UTF-8'));
    }
    const id = `hl-${++this.hostSeq}`;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method: 'host.log', params: { level, message } });
    return new Promise((resolve, reject) => {
      if (signal?.aborted || this.closed) { reject(new ProtocolError(-32800, 'request cancelled')); return; }
      this.hostPending.set(id, { resolve: () => resolve(), reject });
      signal?.addEventListener('abort', () => { if (this.hostPending.delete(id)) reject(new ProtocolError(-32800, 'request cancelled')); }, { once: true });
      this.enqueue(frame);
    });
  }

  /** Describe reads the host binding for this process. Params cannot select another plugin. */
  describe(signal?: AbortSignal): Promise<{ pluginId: string; generation: number; hostVersion: string; locale: string }> {
    const id = `hl-${++this.hostSeq}`;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method: 'host.describe', params: {} });
    return new Promise((resolve, reject) => {
      if (signal?.aborted || this.closed) { reject(new ProtocolError(-32800, 'request cancelled')); return; }
      this.hostPending.set(id, { resolve: (value) => {
        if (typeof value.pluginId !== 'string' || value.pluginId.length === 0 || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation <= 0 || typeof value.hostVersion !== 'string' || typeof value.locale !== 'string') {
          reject(new ProtocolError(-32603, 'host describe response is incomplete')); return;
        }
        resolve({ pluginId: value.pluginId, generation: value.generation, hostVersion: value.hostVersion, locale: value.locale });
      }, reject });
      signal?.addEventListener('abort', () => { if (this.hostPending.delete(id)) reject(new ProtocolError(-32800, 'request cancelled')); }, { once: true });
      this.enqueue(frame);
    });
  }

  private initialize(id: RequestID, value: unknown): void {
    if (!isInitializeParams(value)) {
      this.reply(id, undefined, new ProtocolError(-32602, 'unsupported initialization')); return;
    }
    if (this.initialized || this.initializing) {
      this.reply(id, undefined, new ProtocolError(-32600, 'already initialized')); return;
    }
    this.initializing = true;
    // Configuration is JSON data; callback authors validate its application schema.
    const params = value;
    this.start(id, async (signal) => {
      try {
        await this.options.initialize?.(params, signal);
        if (!signal.aborted && !this.closed && !this.stopping) this.initialized = true;
        return { apiVersion: 1 };
      } finally { this.initializing = false; }
    });
  }

  private invoke(id: RequestID, value: unknown, frame: string): void {
    if (!this.initialized) { this.reply(id, undefined, new ProtocolError(-32002, 'plugin is not initialized')); return; }
    if (!record(value) || typeof value.commandId !== 'string') {
      this.reply(id, undefined, new ProtocolError(-32602, 'invalid parameters')); return;
    }
    const handler = Object.hasOwn(this.handlers, value.commandId) ? this.handlers[value.commandId] : undefined;
    if (!handler) { this.reply(id, undefined, new ProtocolError(-32601, 'command not found')); return; }
    if (Object.hasOwn(handler, 'validateInvokeFrame')) {
      try { if (typeof handler.validateInvokeFrame !== 'function') throw new Error('invalid validator'); handler.validateInvokeFrame(frame); }
      catch { this.reply(id, undefined, new ProtocolError(-32602, 'invalid export invocation')); return; }
    }
    const args = (value.arguments ?? null) as JSONValue;
    this.start(id, (signal) => handler(args, signal));
  }

  private start(id: RequestID, handler: (signal: AbortSignal) => JSONValue | Promise<JSONValue>): void {
    if (this.active.has(id) || this.active.size >= this.maxConcurrent) {
      this.reply(id, undefined, new ProtocolError(-32001, 'duplicate request or concurrency limit')); return;
    }
    const controller = new AbortController();
    this.active.set(id, controller);
    void Promise.resolve().then(() => handler(controller.signal)).then(
      (result) => this.finish(id, controller, result),
      (error: unknown) => this.finish(id, controller, undefined, error instanceof ProtocolError
        ? error : new ProtocolError(-32603, 'handler failed')),
    );
  }

  private finish(id: RequestID, controller: AbortController, value?: JSONValue, error?: unknown): void {
    this.active.delete(id);
    if (this.closed || this.stopping) return;
    if (controller.signal.aborted) error = new ProtocolError(-32800, 'request cancelled');
    this.reply(id, value, error);
  }

  private shutdown(id: RequestID): void {
    this.stopping = true;
    this.closeRoots();
    for (const controller of this.active.values()) controller.abort();
    this.reply(id, {});
    void this.output.finally(() => this.close());
  }

  private deliverLifecycle(value: unknown): void {
    if (!record(value) || value.event !== 'running' || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation <= 0) return;
    const event = value.event;
    const generation = value.generation;
    void Promise.resolve().then(() => this.options.onLifecycle?.({ event, generation }));
  }

  private deliverHostResponse(message: unknown): boolean {
    if (!record(message) || message.jsonrpc !== '2.0' || 'method' in message || typeof message.id !== 'string') return false;
    const pending = this.hostPending.get(message.id);
    if (!pending) return false;
    this.hostPending.delete(message.id);
    const failure = record(message.error) ? message.error : undefined;
    if (failure && typeof failure.code === 'number') pending.reject(new ProtocolError(failure.code, 'host log was rejected'));
    else if (!record(message.result)) pending.reject(new ProtocolError(-32603, 'host log response is not an object'));
    else pending.resolve(message.result as Record<string, unknown>);
    return true;
  }

  private enqueue(frame: string): void {
    if (this.closed) return;
    if (encoder.encode(frame).length > this.maxFrameBytes || this.queued >= 64) { this.fatal(new Error('protocol output limit exceeded')); return; }
    this.queued++;
    this.output = this.output.then(async () => { if (!this.closed) await this.options.send(frame + '\n'); })
      .catch((failure: unknown) => this.fatal(failure instanceof Error ? failure : new Error('transport failed')))
      .finally(() => { this.queued--; });
  }

  private reply(id: RequestID | null, value?: JSONValue, error?: unknown): void {
    if (this.closed) return;
    const rpcError: RPCError | undefined = error === undefined ? undefined : error instanceof ProtocolError
      ? { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) }
      : { code: -32603, message: 'handler failed' };
    const response: RPCResponse = rpcError ? { jsonrpc: '2.0', id, error: rpcError } : { jsonrpc: '2.0', id, result: value ?? null };
    let frame: string;
    try { frame = JSON.stringify(response); }
    catch { frame = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'invalid handler result' } }); }
    if (encoder.encode(frame).length > this.maxFrameBytes) {
      frame = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'response exceeds frame limit' } });
    }
    if (encoder.encode(frame).length > this.maxFrameBytes || this.queued >= 64) {
      this.fatal(new Error('protocol output limit exceeded')); return;
    }
    this.queued++;
    this.output = this.output.then(async () => {
      if (!this.closed) await this.options.send(frame + '\n');
    }).catch((failure: unknown) => this.fatal(failure instanceof Error ? failure : new Error('transport failed')))
      .finally(() => { this.queued--; });
  }

  private closeRoots(): void {
    if (this.rootsClosed) return;
    this.rootsClosed = true;
    try { this.options.onClose?.(); }
    catch { this.options.onFatal?.(new Error('plugin close hook failed')); }
  }

  private fatal(error: Error): void {
    this.close();
    this.options.onFatal?.(error);
  }
}
