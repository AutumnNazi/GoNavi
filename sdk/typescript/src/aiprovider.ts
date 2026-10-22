import type { Handler } from './protocol.js';
import type { JSONValue } from './types.js';
import type { AIProviderDispatcherOptions, AIProviderErrorCode, AIProviderLimits, AIProviderRegistration,
  AIProviderRegistryOptions, AIProviderStart } from './aiproviderTypes.js';
import { completion } from './aiproviderOutput.js';
import { AIProviderQueue } from './aiproviderQueue.js';
import { AIProviderFault, control, envelope, fault, providerID, record, registration, resolveLimits, rpcFault, start } from './aiproviderValidation.js';

export { AI_PROVIDER_PROTOCOL_VERSION, AI_PROVIDER_DEFAULT_LIMITS } from './aiproviderTypes.js';
export { AI_PROVIDER_IMAGE_MAX_REQUEST_BYTES } from './aiproviderImages.js';
export type * from './aiproviderTypes.js';

/** Independent pull-stream lifecycle. Start RPC signals never own generation callbacks.
 * Callbacks must yield and honor their signal; JavaScript cannot forcibly stop an uncooperative callback.
 * Such callbacks retain their worker slots until they actually settle, including after close times out. */
export class AIProviderDispatcher {
  private readonly root = new AbortController();
  private readonly limits: Readonly<AIProviderLimits>;
  private readonly providers = new Map<string, AIProviderRegistration>();
  private readonly sessions = new Map<string, AIProviderQueue>();
  private readonly consumers = new Set<AIProviderQueue>();
  private readonly workers = new Map<string, { queue: AIProviderQueue; task: Promise<void> }>();
  private readonly tombstones = new Map<string, AIProviderErrorCode>();
  private detachRoot?: () => void;
  private closing?: Promise<void>;
  private joinReady?: () => void;

  constructor(options: AIProviderDispatcherOptions | AIProviderRegistryOptions) {
    if (!record(options)) fault('invalid_request');
    this.limits = resolveLimits(options.limits);
    if (Object.keys(options).some((key) => !['providers', 'rootSignal', 'limits'].includes(key)) ||
        !record(options.providers) || Object.keys(options.providers).length < 1 || Object.keys(options.providers).length > 8) fault('invalid_request');
    for (const [id, value] of Object.entries(options.providers)) {
      if (!providerID(id)) fault('invalid_request');
      this.providers.set(id, registration(value));
    }
    if (options.rootSignal !== undefined) {
      const signal = options.rootSignal;
      const abort = () => this.abort();
      this.detachRoot = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) this.abort();
    }
  }

  readonly handle: Handler = async (input, signal) => {
    try {
      if (signal.aborted || this.root.signal.aborted) fault('canceled');
      const value = envelope(input, this.limits);
      const id = value.providerId as string;
      const provider = this.resolve(id);
      const key = `${id}/${value.requestId as string}`;
      if (value.operation === 'start') return this.admit(key, start(value, provider), provider);
      const request = control(value);
      if (request.operation === 'cancel') {
        this.retire(key, 'canceled');
        return { ok: true };
      }
      const queue = this.sessions.get(key);
      if (!queue) fault(this.tombstones.get(key) ?? 'invalid_request');
      if (this.consumers.has(queue)) fault('invalid_request');
      this.consumers.add(queue);
      try {
        const events = await queue.pull(signal);
        const current = this.sessions.get(key) === queue;
        if (current && events.some((event) => event.type !== 'delta')) this.retire(key, 'invalid_request');
        if (signal.aborted || this.root.signal.aborted) fault('canceled');
        if (!current) fault(this.tombstones.get(key) ?? 'invalid_request');
        return { events } as JSONValue;
      } finally { this.consumers.delete(queue); }
    } catch (error: unknown) {
      throw rpcFault(error instanceof AIProviderFault ? error.kind : 'invalid_request');
    }
  };

  /** Synchronous Protocol.onClose hook. Root cancellation reaches every live callback and queue. */
  readonly abort = (): void => {
    if (this.root.signal.aborted) return;
    this.root.abort(); this.detachRoot?.(); this.detachRoot = undefined;
    for (const queue of this.sessions.values()) queue.dispose('canceled');
    for (const worker of this.workers.values()) worker.queue.dispose('canceled');
    this.sessions.clear(); this.tombstones.clear();
  };

  /** Abort immediately, then join workers for at most closeWaitMs (or until the caller cancels). */
  close(signal?: AbortSignal): Promise<void> {
    this.abort();
    if (this.closing) return this.closing;
    if (!this.workers.size || signal?.aborted) return Promise.resolve();
    this.closing = new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', finish);
        this.joinReady = undefined; resolve();
      };
      const timer = setTimeout(finish, this.limits.closeWaitMs);
      this.joinReady = finish;
      signal?.addEventListener('abort', finish, { once: true });
      if (!this.workers.size || signal?.aborted) finish();
    });
    return this.closing;
  }

  private resolve(id: string): AIProviderRegistration {
    const provider = this.providers.get(id);
    if (!provider) fault('unsupported');
    return provider;
  }

  private admit(key: string, request: AIProviderStart, provider: AIProviderRegistration): JSONValue {
    if (this.sessions.has(key) || this.workers.has(key) || this.tombstones.has(key)) fault(this.tombstones.get(key) ?? 'invalid_request');
    if (this.workers.size >= this.limits.maxWorkers || this.sessions.size >= this.limits.maxSessions) fault('limit_exceeded');
    const offered = new Set(request.request.tools?.map((tool) => tool.function.name) ?? []);
    const queue = new AIProviderQueue(this.limits, () => this.retire(key, 'deadline'));
    this.sessions.set(key, queue);
    // Register before invoking user code. Canceled callbacks keep this entry until their real settlement.
    const task = Promise.resolve().then(() => this.run(key, queue, request, provider, offered));
    this.workers.set(key, { queue, task });
    return { accepted: true };
  }

  private async run(key: string, queue: AIProviderQueue, request: AIProviderStart, provider: AIProviderRegistration, offered: ReadonlySet<string>): Promise<void> {
    try {
      if (this.root.signal.aborted || queue.signal.aborted) return;
      const value = await provider.generate(request, queue.signal, queue.emit);
      if (!queue.ended) {
        try { queue.complete(completion(value, this.limits.maxEventBytes, provider.supportsTools, offered)); }
        catch (error: unknown) { queue.fail(error instanceof AIProviderFault ? error.kind : 'generation_failed'); }
      }
    } catch { queue.fail('generation_failed'); }
    finally {
      this.workers.delete(key);
      if (!this.workers.size) this.joinReady?.();
    }
  }

  private retire(key: string, code: AIProviderErrorCode): void {
    const queue = this.sessions.get(key);
    queue?.dispose(code); this.sessions.delete(key);
    // A canceled worker can outlive its output record and its bounded recent tombstone.
    this.workers.get(key)?.queue.dispose(code);
    if (this.root.signal.aborted || this.tombstones.has(key)) return;
    this.tombstones.set(key, code);
    if (this.tombstones.size > this.limits.maxTombstones) {
      const first = this.tombstones.keys().next();
      if (!first.done) this.tombstones.delete(first.value);
    }
  }
}
