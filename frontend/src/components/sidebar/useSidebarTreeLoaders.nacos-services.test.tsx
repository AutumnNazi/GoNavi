import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarTreeLoaders } from './useSidebarTreeLoaders';

const mocks = vi.hoisted(() => ({
  replaceTreeNodeChildren: vi.fn(),
  setLoadedKeys: vi.fn(),
  storeState: {
    connections: [] as any[],
    tableSortPreference: {} as Record<string, string>,
    tableAccessCount: {} as Record<string, number>,
    pinnedSidebarTables: [] as string[],
  },
}));

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../store', async () => {
  const actual = await vi.importActual<typeof import('../../store')>('../../store');
  const useStore = Object.assign(vi.fn(), {
    getState: () => mocks.storeState,
  });
  return { ...actual, useStore };
});

vi.mock('../../../wailsjs/go/app/App', () => ({
  DBGetDatabases: vi.fn(),
  DBGetTables: vi.fn(),
  DBQuery: vi.fn(),
  GetDriverStatusList: vi.fn(),
  JVMProbeCapabilities: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('useSidebarTreeLoaders Nacos service groups', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replaceTreeNodeChildren.mockImplementation((_key, children) => children || []);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    vi.unstubAllGlobals();
  });

  it('keeps a forced refresh result when an older group request resolves later', async () => {
    const oldResponse = deferred<any>();
    const refreshedResponse = deferred<any>();
    const listServices = vi.fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(refreshedResponse.promise);
    vi.stubGlobal('window', {
      go: { app: { App: { NacosListServices: listServices } } },
    });

    let loaders: ReturnType<typeof useSidebarTreeLoaders> | undefined;
    const loadingNodesRef = { current: new Set<string>() };
    const Harness = () => {
      loaders = useSidebarTreeLoaders({
        savedQueries: [],
        tableSortPreference: {},
        tableAccessCount: {},
        pinnedSidebarTables: [],
        isV2Ui: true,
        loadingNodesRef,
        setConnectionStates: vi.fn(),
        setLoadedKeys: mocks.setLoadedKeys,
        replaceTreeNodeChildren: mocks.replaceTreeNodeChildren,
        buildRuntimeConfig: (conn) => conn.config,
        buildJVMRuntimeConfig: (conn) => conn.config,
        buildJVMDiagnosticTreeNodes: () => [],
        resolveSavedQueryDisplayName: (name) => String(name || ''),
      });
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });

    const node = {
      key: 'nacos-1-nacos-ns-dev-services',
      dataRef: {
        id: 'nacos-1',
        nacosNamespaceId: 'dev',
        nacosNamespaceName: 'Development',
        config: { type: 'nacos', host: '127.0.0.1', port: 8848 },
      },
    };
    const oldLoad = loaders!.loadNacosServiceGroups(node);
    const refreshedLoad = loaders!.loadNacosServiceGroups(node, { force: true });

    refreshedResponse.resolve({
      success: true,
      data: { count: 1, serviceNames: ['NEW_GROUP@@orders'] },
    });
    await act(async () => {
      expect(await refreshedLoad).toBe(true);
    });

    expect(mocks.replaceTreeNodeChildren).toHaveBeenCalledTimes(1);
    expect(mocks.replaceTreeNodeChildren.mock.calls[0][1].map((item: any) => item.dataRef.nacosGroup))
      .toEqual(['', 'NEW_GROUP']);

    oldResponse.resolve({
      success: true,
      data: { count: 1, serviceNames: ['OLD_GROUP@@legacy'] },
    });
    await act(async () => {
      expect(await oldLoad).toBe(false);
    });

    expect(mocks.replaceTreeNodeChildren).toHaveBeenCalledTimes(1);
    expect(loadingNodesRef.current.size).toBe(0);
  });
});
