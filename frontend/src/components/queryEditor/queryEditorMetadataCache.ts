export type QueryEditorMetadataCacheScope = {
  connectionId: string;
  databaseKey: string;
};

type QueryEditorMetadataCacheEntry<T> = QueryEditorMetadataCacheScope & {
  value: T;
  bytes: number;
  expiresAt: number;
};

type QueryEditorMetadataCacheOptions<T> = {
  maxEntries: number;
  maxEntriesPerConnection: number;
  maxBytes: number;
  ttlMs: number;
  now?: () => number;
  estimateBytes?: (value: T) => number;
};

const positiveLimit = (value: number): number => (
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
);

export const estimateQueryEditorMetadataBytes = (value: unknown): number => {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  let bytes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || current === undefined) {
      bytes += 4;
      continue;
    }
    if (typeof current === 'string') {
      bytes += current.length * 2;
      continue;
    }
    if (typeof current === 'number' || typeof current === 'bigint') {
      bytes += 8;
      continue;
    }
    if (typeof current === 'boolean') {
      bytes += 4;
      continue;
    }
    if (typeof current !== 'object') {
      bytes += 8;
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      bytes += 16 + current.length * 8;
      for (const item of current) pending.push(item);
      continue;
    }
    bytes += 24;
    Object.entries(current).forEach(([key, entry]) => {
      bytes += key.length * 2;
      pending.push(entry);
    });
  }

  return Math.max(1, bytes);
};

export class BoundedQueryEditorMetadataCache<T> {
  private readonly entries = new Map<string, QueryEditorMetadataCacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly maxEntriesPerConnection: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly estimateBytes: (value: T) => number;
  private totalBytes = 0;

  constructor(options: QueryEditorMetadataCacheOptions<T>) {
    this.maxEntries = positiveLimit(options.maxEntries);
    this.maxEntriesPerConnection = positiveLimit(options.maxEntriesPerConnection);
    this.maxBytes = positiveLimit(options.maxBytes);
    this.ttlMs = positiveLimit(options.ttlMs);
    this.now = options.now || Date.now;
    this.estimateBytes = options.estimateBytes || estimateQueryEditorMetadataBytes;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, scope: QueryEditorMetadataCacheScope, value: T): void {
    this.pruneExpired();
    this.delete(key);
    const bytes = Math.max(1, Math.floor(this.estimateBytes(value)) || 1);
    if (bytes > this.maxBytes) return;

    this.entries.set(key, {
      connectionId: String(scope.connectionId || '').trim(),
      databaseKey: String(scope.databaseKey || '').trim(),
      value,
      bytes,
      expiresAt: this.now() + this.ttlMs,
    });
    this.totalBytes += bytes;
    this.enforceConnectionLimit(String(scope.connectionId || '').trim());
    this.enforceGlobalLimits();
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    return true;
  }

  invalidate(connectionId: string, databaseKey?: string): void {
    const normalizedConnectionId = String(connectionId || '').trim();
    const normalizedDatabaseKey = String(databaseKey || '').trim();
    for (const [key, entry] of this.entries) {
      if (entry.connectionId !== normalizedConnectionId) continue;
      if (normalizedDatabaseKey && entry.databaseKey !== normalizedDatabaseKey) continue;
      this.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  stats(): { entries: number; bytes: number } {
    this.pruneExpired();
    return { entries: this.entries.size, bytes: this.totalBytes };
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.delete(key);
    }
  }

  private enforceConnectionLimit(connectionId: string): void {
    let entriesForConnection = 0;
    for (const entry of this.entries.values()) {
      if (entry.connectionId === connectionId) entriesForConnection += 1;
    }
    if (entriesForConnection <= this.maxEntriesPerConnection) return;
    for (const [key, entry] of this.entries) {
      if (entry.connectionId !== connectionId) continue;
      this.delete(key);
      entriesForConnection -= 1;
      if (entriesForConnection <= this.maxEntriesPerConnection) return;
    }
  }

  private enforceGlobalLimits(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.delete(oldestKey);
    }
  }
}
