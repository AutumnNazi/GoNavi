import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  CancelQuery: vi.fn(),
  DBGetAllColumnsWithCancel: vi.fn(),
  DBGetColumnsWithCancel: vi.fn(),
  DBGetDatabasesWithCancel: vi.fn(),
  DBGetTablesWithCancel: vi.fn(),
  DBQueryApplicationWithCancel: vi.fn(),
  DBShowCreateTableWithCancel: vi.fn(),
}));

vi.mock('../../../wailsjs/go/app/App', () => backend);

import {
  QueryEditorMetadataRequestPool,
  queryEditorMetadataGetTables,
  reconcileQueryEditorMetadataConnections,
  resetQueryEditorMetadataRequests,
} from './queryEditorMetadataRequests';

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('QueryEditorMetadataRequestPool', () => {
  it('deduplicates work and aborts it only after the last consumer leaves', async () => {
    const pool = new QueryEditorMetadataRequestPool(2);
    const first = new AbortController();
    const second = new AbortController();
    let internalSignal: AbortSignal | undefined;
    const run = vi.fn((signal: AbortSignal) => {
      internalSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    });

    const firstResult = pool.request({
      connectionId: 'conn-a',
      key: 'tables:main',
      signal: first.signal,
      run,
    });
    const secondResult = pool.request({
      connectionId: 'conn-a',
      key: 'tables:main',
      signal: second.signal,
      run,
    });

    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    first.abort();
    await expect(firstResult).rejects.toMatchObject({ name: 'AbortError' });
    expect(internalSignal?.aborted).toBe(false);

    second.abort();
    await expect(secondResult).rejects.toMatchObject({ name: 'AbortError' });
    expect(internalSignal?.aborted).toBe(true);
  });

  it('keeps legacy work within the per-connection concurrency budget', async () => {
    const pool = new QueryEditorMetadataRequestPool(2);
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const releases: Array<() => void> = [];
    let started = 0;
    const request = (index: number) => pool.request({
      connectionId: 'slow-ssh',
      key: `request-${index}`,
      signal: controllers[index].signal,
      run: () => new Promise<number>((resolve) => {
        started += 1;
        releases.push(() => resolve(index));
      }),
    });

    const results = controllers.map((_controller, index) => request(index));
    await flush();
    expect(started).toBe(2);

    controllers.forEach((controller) => controller.abort());
    await Promise.all(results.map((result) => expect(result).rejects.toMatchObject({ name: 'AbortError' })));
    await flush();
    expect(started).toBe(2);

    releases.forEach((release) => release());
    await flush();
    expect(pool.stats()).toEqual({ active: 0, queued: 0, shared: 0 });
  });

  it('allows the same request key to retry after every consumer cancels', async () => {
    const pool = new QueryEditorMetadataRequestPool(2);
    const firstController = new AbortController();
    const firstRun = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }));
    const firstResult = pool.request({
      connectionId: 'conn-a',
      key: 'columns:users',
      signal: firstController.signal,
      run: firstRun,
    });
    await flush();
    firstController.abort();
    await expect(firstResult).rejects.toMatchObject({ name: 'AbortError' });
    await flush();

    const retryRun = vi.fn(async () => 'fresh');
    await expect(pool.request({
      connectionId: 'conn-a',
      key: 'columns:users',
      run: retryRun,
    })).resolves.toBe('fresh');
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(retryRun).toHaveBeenCalledTimes(1);
  });

  it('bounds queued legacy work even when the backend ignores cancellation', async () => {
    const pool = new QueryEditorMetadataRequestPool(1, 2);
    let releaseActive: (() => void) | undefined;
    const outcomes = Array.from({ length: 5 }, (_, index) => pool.request({
      connectionId: 'legacy',
      key: `legacy-${index}`,
      run: () => new Promise<number>((resolve) => {
        if (!releaseActive) releaseActive = () => resolve(index);
      }),
    }).catch((error) => error));

    await flush();
    expect(pool.stats()).toEqual({ active: 1, queued: 2, shared: 3 });
    await expect(Promise.all(outcomes.slice(3))).resolves.toEqual([
      expect.objectContaining({ name: 'AbortError' }),
      expect.objectContaining({ name: 'AbortError' }),
    ]);

    pool.cancel('legacy');
    releaseActive?.();
    await Promise.all(outcomes);
    await flush();
    expect(pool.stats()).toEqual({ active: 0, queued: 0, shared: 0 });
  });
});

describe('query editor metadata RPC', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    resetQueryEditorMetadataRequests();
    vi.clearAllMocks();
    backend.CancelQuery.mockResolvedValue({ success: true });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  });

  afterEach(() => {
    resetQueryEditorMetadataRequests();
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('cancels the generated Wails query ID when its consumer aborts', async () => {
    let release: ((value: unknown) => void) | undefined;
    backend.DBGetTablesWithCancel.mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const controller = new AbortController();
    const result = queryEditorMetadataGetTables(
      'conn-a',
      { type: 'postgres' } as never,
      'main',
      controller.signal,
    );

    await vi.waitFor(() => expect(backend.DBGetTablesWithCancel).toHaveBeenCalledWith(
      { type: 'postgres' },
      'main',
      expect.stringMatching(/^metadata-/),
    ));
    const queryID = backend.DBGetTablesWithCancel.mock.calls[0][2];
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.CancelQuery).toHaveBeenCalledWith(queryID);
    release?.({ success: false, message: 'context canceled' });
  });

  it('uses the request-scoped Web RPC bridge without dispatching the Wails fallback', async () => {
    const invokeWithOptions = vi.fn(async () => ({ success: true, data: [] }));
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __GONAVI_WEB_RPC__: { invokeWithOptions } },
    });
    const controller = new AbortController();

    await expect(queryEditorMetadataGetTables(
      'conn-a',
      { type: 'postgres' } as never,
      'main',
      controller.signal,
    )).resolves.toMatchObject({ success: true });

    expect(invokeWithOptions).toHaveBeenCalledWith(
      'app',
      'App',
      'DBGetTables',
      [{ type: 'postgres' }, 'main'],
      { signal: expect.any(AbortSignal) },
    );
    expect(backend.DBGetTablesWithCancel).not.toHaveBeenCalled();
  });

  it('reports connection config replacement and deletion exactly once', () => {
    const firstConfig = { type: 'postgres', host: 'one' };
    const nextConfig = { type: 'postgres', host: 'two' };

    expect(reconcileQueryEditorMetadataConnections([
      { id: 'conn-a', config: firstConfig },
    ])).toEqual([]);
    expect(reconcileQueryEditorMetadataConnections([
      { id: 'conn-a', config: firstConfig },
    ])).toEqual([]);
    expect(reconcileQueryEditorMetadataConnections([
      { id: 'conn-a', config: nextConfig },
    ])).toEqual(['conn-a']);
    nextConfig.host = 'three';
    expect(reconcileQueryEditorMetadataConnections([
      { id: 'conn-a', config: nextConfig },
    ])).toEqual(['conn-a']);
    expect(reconcileQueryEditorMetadataConnections([])).toEqual(['conn-a']);
  });
});
