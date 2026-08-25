import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectionSidebarLayout,
  ConnectionSidebarLayoutInput,
} from '../types';
import {
  createConnectionSidebarLayoutCoordinator,
  type ConnectionSidebarLayoutStore,
} from './connectionSidebarLayoutCoordinator';

const cloneLayout = <T extends ConnectionSidebarLayoutInput>(layout: T): T =>
  JSON.parse(JSON.stringify(layout)) as T;

const createLayoutStore = (initial: ConnectionSidebarLayoutInput) => {
  let current = cloneLayout(initial);
  const listeners = new Set<() => void>();
  const adapter: ConnectionSidebarLayoutStore = {
    getLayout: () => cloneLayout(current),
    replaceLayout: (layout) => {
      current = cloneLayout(layout);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    adapter,
    read: () => cloneLayout(current),
    update: (layout: ConnectionSidebarLayoutInput) => adapter.replaceLayout(layout),
  };
};

const emptyLayout: ConnectionSidebarLayoutInput = {
  connectionTags: [],
  sidebarRootOrder: [],
};

const remoteLayout: ConnectionSidebarLayout = {
  initialized: true,
  revision: 7,
  connectionTags: [
    {
      id: 'group-dev',
      name: '开发',
      connectionIds: ['conn-a'],
      childOrder: ['connection:conn-a'],
    },
  ],
  sidebarRootOrder: ['tag:group-dev'],
};

describe('connection sidebar layout coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies an initialized backend layout without echoing it back during bootstrap', async () => {
    const store = createLayoutStore(emptyLayout);
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => cloneLayout(remoteLayout)),
      SaveConnectionSidebarLayout: vi.fn(),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
    });

    const result = await coordinator.bootstrap();

    expect(result).toEqual({ available: true, initialized: true, revision: 7 });
    expect(store.read()).toEqual({
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('keeps a missing empty layout absent until the user creates a group', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore(emptyLayout);
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => ({
        initialized: false,
        revision: 0,
        ...emptyLayout,
      })),
      SaveConnectionSidebarLayout: vi.fn(async (input) => ({
        conflict: false,
        layout: {
          initialized: true,
          revision: 1,
          connectionTags: input.layout.connectionTags,
          sidebarRootOrder: input.layout.sidebarRootOrder,
        },
      })),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });

    await coordinator.bootstrap();
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();

    const grouped: ConnectionSidebarLayoutInput = {
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(grouped);
    await vi.advanceTimersByTimeAsync(159);
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledWith({
      expectedRevision: 0,
      layout: grouped,
    });
    coordinator.dispose();
  });

  it('offers a non-empty legacy local layout as the atomic bootstrap candidate', async () => {
    const candidate: ConnectionSidebarLayoutInput = {
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    const store = createLayoutStore(candidate);
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async (input) => ({
        initialized: true,
        revision: 1,
        ...cloneLayout(input),
      })),
      SaveConnectionSidebarLayout: vi.fn(),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
    });

    await expect(coordinator.bootstrap()).resolves.toEqual({
      available: true,
      initialized: true,
      revision: 1,
    });
    expect(backend.BootstrapConnectionSidebarLayout).toHaveBeenCalledWith(candidate);
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('persists an explicit root-order change after an empty bootstrap stays absent', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore(emptyLayout);
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => ({
        initialized: false,
        revision: 0,
        ...emptyLayout,
      })),
      SaveConnectionSidebarLayout: vi.fn(async (input) => ({
        conflict: false,
        layout: {
          initialized: true,
          revision: 1,
          ...input.layout,
        },
      })),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });
    await coordinator.bootstrap();
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();

    const reordered: ConnectionSidebarLayoutInput = {
      connectionTags: [],
      sidebarRootOrder: ['connection:conn-b', 'connection:conn-a'],
    };
    store.update(reordered);
    await vi.advanceTimersByTimeAsync(160);

    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledWith({
      expectedRevision: 0,
      layout: reordered,
    });
    coordinator.dispose();
  });

  it('coalesces changes made during an in-flight save and reuses the returned revision', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore({
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    let resolveFirstSave!: (result: {
      conflict: false;
      layout: ConnectionSidebarLayout;
    }) => void;
    const firstSave = new Promise<{
      conflict: false;
      layout: ConnectionSidebarLayout;
    }>((resolve) => {
      resolveFirstSave = resolve;
    });
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => cloneLayout(remoteLayout)),
      SaveConnectionSidebarLayout: vi
        .fn()
        .mockImplementationOnce(() => firstSave)
        .mockImplementationOnce(async (input) => ({
          conflict: false,
          layout: {
            initialized: true,
            revision: 9,
            connectionTags: input.layout.connectionTags,
            sidebarRootOrder: input.layout.sidebarRootOrder,
          },
        })),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });
    await coordinator.bootstrap();

    const firstChange: ConnectionSidebarLayoutInput = {
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '开发一' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(firstChange);
    await vi.advanceTimersByTimeAsync(160);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(1);

    const latestChange: ConnectionSidebarLayoutInput = {
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '开发二' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(latestChange);
    await vi.advanceTimersByTimeAsync(160);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(1);

    resolveFirstSave({
      conflict: false,
      layout: {
        initialized: true,
        revision: 8,
        ...firstChange,
      },
    });
    await vi.runAllTimersAsync();

    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(2);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenLastCalledWith({
      expectedRevision: 8,
      layout: latestChange,
    });
    coordinator.dispose();
  });

  it('applies the authoritative backend layout on conflict without echo-saving it', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore({
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    const concurrentLayout: ConnectionSidebarLayout = {
      initialized: true,
      revision: 8,
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '另一实例' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => cloneLayout(remoteLayout)),
      SaveConnectionSidebarLayout: vi.fn(async () => ({
        conflict: true,
        layout: cloneLayout(concurrentLayout),
      })),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });
    await coordinator.bootstrap();

    store.update({
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '本实例' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    await vi.advanceTimersByTimeAsync(160);
    await vi.advanceTimersByTimeAsync(500);

    expect(store.read()).toEqual({
      connectionTags: concurrentLayout.connectionTags,
      sidebarRootOrder: concurrentLayout.sidebarRootOrder,
    });
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('flushes a pending layout immediately and waits for the backend save', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore({
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    let resolveSave!: (result: {
      conflict: false;
      layout: ConnectionSidebarLayout;
    }) => void;
    const saveResult = new Promise<{
      conflict: false;
      layout: ConnectionSidebarLayout;
    }>((resolve) => {
      resolveSave = resolve;
    });
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => cloneLayout(remoteLayout)),
      SaveConnectionSidebarLayout: vi.fn(() => saveResult),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });
    await coordinator.bootstrap();
    const changed: ConnectionSidebarLayoutInput = {
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '退出前修改' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(changed);

    let flushFinished = false;
    const flushPromise = coordinator.flush().then(() => {
      flushFinished = true;
    });
    await Promise.resolve();
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledWith({
      expectedRevision: 7,
      layout: changed,
    });
    expect(flushFinished).toBe(false);

    resolveSave({
      conflict: false,
      layout: {
        initialized: true,
        revision: 8,
        ...changed,
      },
    });
    await flushPromise;
    expect(flushFinished).toBe(true);
    coordinator.dispose();
  });

  it('retains the latest pending layout after a failed save and retries only on flush', async () => {
    vi.useFakeTimers();
    const store = createLayoutStore({
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    });
    let rejectFirstSave!: (error: Error) => void;
    const firstSave = new Promise<never>((_resolve, reject) => {
      rejectFirstSave = reject;
    });
    const onError = vi.fn();
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => cloneLayout(remoteLayout)),
      SaveConnectionSidebarLayout: vi
        .fn()
        .mockImplementationOnce(() => firstSave)
        .mockImplementationOnce(async (input) => ({
          conflict: false,
          layout: {
            initialized: true,
            revision: 8,
            ...input.layout,
          },
        })),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
      onError,
    });
    await coordinator.bootstrap();

    const firstChange: ConnectionSidebarLayoutInput = {
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '第一次修改' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(firstChange);
    await vi.advanceTimersByTimeAsync(160);
    const latestChange: ConnectionSidebarLayoutInput = {
      connectionTags: [{ ...remoteLayout.connectionTags[0], name: '失败期间的最新修改' }],
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    store.update(latestChange);
    await vi.advanceTimersByTimeAsync(160);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(1);

    rejectFirstSave(new Error('disk temporarily busy'));
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(1);

    await coordinator.flush();
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenCalledTimes(2);
    expect(backend.SaveConnectionSidebarLayout).toHaveBeenLastCalledWith({
      expectedRevision: 7,
      layout: latestChange,
    });
    coordinator.dispose();
  });

  it('completes with the local layout and disables writes when bootstrap fails', async () => {
    vi.useFakeTimers();
    const localLayout: ConnectionSidebarLayoutInput = {
      connectionTags: remoteLayout.connectionTags,
      sidebarRootOrder: remoteLayout.sidebarRootOrder,
    };
    const store = createLayoutStore(localLayout);
    const backend = {
      BootstrapConnectionSidebarLayout: vi.fn(async () => {
        throw new Error('layout file temporarily unavailable');
      }),
      SaveConnectionSidebarLayout: vi.fn(),
    };
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend,
      store: store.adapter,
      debounceMs: 160,
    });

    await expect(coordinator.bootstrap()).resolves.toEqual({
      available: false,
      initialized: false,
      revision: 0,
    });
    expect(store.read()).toEqual(localLayout);

    store.update({
      ...localLayout,
      connectionTags: [{ ...localLayout.connectionTags[0], name: '仍只保存在本地' }],
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.SaveConnectionSidebarLayout).not.toHaveBeenCalled();
    await expect(coordinator.flush()).resolves.toBeUndefined();
    coordinator.dispose();
  });

  it('completes immediately when the backend layout API is unavailable', async () => {
    const store = createLayoutStore(emptyLayout);
    const coordinator = createConnectionSidebarLayoutCoordinator({
      backend: {},
      store: store.adapter,
    });

    await expect(coordinator.bootstrap()).resolves.toEqual({
      available: false,
      initialized: false,
      revision: 0,
    });
    expect(store.read()).toEqual(emptyLayout);
    coordinator.dispose();
  });
});
