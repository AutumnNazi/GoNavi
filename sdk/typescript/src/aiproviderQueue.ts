import type { AIProviderCompletion, AIProviderDelta, AIProviderErrorCode, AIProviderEvent, AIProviderLimits } from './aiproviderTypes.js';
import { delta } from './aiproviderOutput.js';
import { AIProviderFault, bytes, fault } from './aiproviderValidation.js';

type Entry = { event: AIProviderEvent; size: number };

/** A single bounded producer/consumer queue. Terminal space is reserved before accepting deltas. */
export class AIProviderQueue {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly queue: Entry[] = [];
  private queuedBytes = 0;
  private totalBytes = 0;
  private sequence = 0;
  private terminal = false;
  private disposed?: AIProviderErrorCode;
  private emitting = false;
  private pulling = false;
  private dataReady?: () => void;
  private spaceReady?: () => void;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private retentionTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly limits: Readonly<AIProviderLimits>, private readonly expired: () => void) {
    this.deadlineTimer = setTimeout(() => { this.dispose('deadline'); this.expired(); }, limits.maxDurationMs);
    this.renewLease();
  }

  get ended(): boolean { return this.terminal; }

  /** Await every emit. Only admitted data receives a sequence number. */
  readonly emit = async (input: AIProviderDelta): Promise<void> => {
    this.ensureWritable();
    if (this.emitting) { this.fail('limit_exceeded'); fault('limit_exceeded'); }
    this.emitting = true;
    try {
      const value = delta(input, this.limits.maxEventBytes);
      const event: AIProviderEvent = { sequence: this.sequence + 1, type: 'delta', ...value };
      const size = bytes(event);
      if (size > this.limits.maxEventBytes || size > this.limits.maxQueueBytes - this.limits.maxEventBytes ||
          this.sequence >= this.limits.maxCompletionEvents - 1 ||
          this.totalBytes + size > this.limits.maxCompletionBytes - this.limits.maxEventBytes) fault('limit_exceeded');
      while (this.queue.length >= this.limits.maxQueueEvents - 1 ||
          this.queuedBytes + size > this.limits.maxQueueBytes - this.limits.maxEventBytes) {
        await new Promise<void>((resolve) => { this.spaceReady = resolve; });
        this.spaceReady = undefined;
        this.ensureWritable();
      }
      this.ensureWritable();
      this.append(event, size);
    } catch (error: unknown) {
      const kind = error instanceof AIProviderFault ? error.kind : 'generation_failed';
      this.fail(kind);
      fault(kind);
    } finally { this.emitting = false; }
  };

  complete(value: AIProviderCompletion): void {
    if (this.terminal || this.disposed) return;
    if (this.emitting) { this.fail('generation_failed'); return; }
    const event: AIProviderEvent = { sequence: this.sequence + 1, type: 'done', ...value };
    if (bytes(event) > this.limits.maxEventBytes) { this.fail('limit_exceeded'); return; }
    this.end(event);
  }

  fail(code: AIProviderErrorCode): void {
    if (this.terminal || this.disposed) return;
    this.end({ sequence: this.sequence + 1, type: 'error', code });
    this.controller.abort();
  }

  /** Cancellation/expiry clears output, releases both waiters, and never releases an actual worker slot. */
  dispose(code: AIProviderErrorCode): void {
    if (this.disposed) return;
    if (!this.terminal) this.fail(code);
    this.disposed = code;
    clearTimeout(this.deadlineTimer); clearTimeout(this.retentionTimer); clearTimeout(this.idleTimer);
    this.deadlineTimer = undefined; this.retentionTimer = undefined; this.idleTimer = undefined;
    this.queue.length = 0; this.queuedBytes = 0;
    this.controller.abort();
    this.wake();
  }

  async pull(signal: AbortSignal): Promise<AIProviderEvent[]> {
    if (signal.aborted) fault('canceled');
    if (this.disposed) fault(this.disposed);
    if (this.terminal && !this.queue.length) fault('invalid_request');
    if (this.pulling) fault('invalid_request');
    this.pulling = true;
    this.renewLease();
    try {
      if (!this.queue.length && !this.terminal) await this.waitForData(signal);
      if (signal.aborted) fault('canceled');
      if (this.disposed) fault(this.disposed);
      const events: AIProviderEvent[] = [];
      let size = 13; // {"events":[]}
      while (this.queue.length && events.length < this.limits.maxPullEvents) {
        const next = this.queue[0];
        const added = next.size + (events.length ? 1 : 0);
        if (size + added > this.limits.maxPullBytes) break;
        size += added;
        events.push(next.event); this.queue.shift(); this.queuedBytes -= next.size;
      }
      this.spaceReady?.();
      return events;
    } finally { this.pulling = false; }
  }

  private waitForData(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', wake);
        if (this.dataReady === wake) this.dataReady = undefined;
        resolve();
      };
      const timer = setTimeout(wake, this.limits.pullWaitMs);
      this.dataReady = wake;
      signal.addEventListener('abort', wake, { once: true });
      if (signal.aborted || this.queue.length || this.disposed) wake();
    });
  }

  private append(event: AIProviderEvent, size: number): void {
    this.sequence = event.sequence; this.totalBytes += size; this.queuedBytes += size;
    this.queue.push({ event, size }); this.dataReady?.();
  }

  private end(event: AIProviderEvent): void {
    this.terminal = true;
    this.retentionTimer = setTimeout(() => { this.dispose('deadline'); this.expired(); }, this.limits.retentionMs);
    this.append(event, bytes(event)); this.wake();
  }

  private renewLease(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.dispose('deadline'); this.expired(); }, this.limits.idleLeaseMs);
  }

  private wake(): void { this.dataReady?.(); this.spaceReady?.(); }
  private ensureWritable(): void {
    if (this.disposed) fault(this.disposed);
    if (this.terminal || this.signal.aborted) fault('canceled');
  }
}
