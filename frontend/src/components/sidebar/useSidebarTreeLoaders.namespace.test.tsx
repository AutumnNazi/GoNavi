import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import { t } from '../../i18n';
import { useSidebarTreeLoaders } from './useSidebarTreeLoaders';

const mocks = vi.hoisted(() => ({
  dbGetDatabases: vi.fn(), warning: vi.fn(), replaceTreeNodeChildren: vi.fn(),
  storeState: { connections: [] as SavedConnection[], pinnedSidebarDatabases: [] as string[] },
}));
vi.mock('antd', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  message: { error: vi.fn(), info: vi.fn(), warning: mocks.warning },
}));
vi.mock('../../store', async () => ({
  ...await vi.importActual<typeof import('../../store')>('../../store'),
  useStore: Object.assign(vi.fn(), { getState: () => mocks.storeState }),
}));
vi.mock('../../../wailsjs/go/app/App', () => ({
  DBGetDatabases: mocks.dbGetDatabases, DBGetTables: vi.fn(), DBRefreshTableStats: vi.fn(),
  DBQuery: vi.fn(), GetDriverStatusList: vi.fn(), JVMProbeCapabilities: vi.fn(),
}));

const flatten = (nodes: SidebarTreeNode[]): SidebarTreeNode[] =>
  nodes.flatMap((node) => [node, ...flatten((node.children || []) as SidebarTreeNode[])]);

describe('namespace loading with an old database display scope', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replaceTreeNodeChildren.mockImplementation((_key, children) => children);
  });
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

  it.each(['iris', 'cache'])('loads the explicit %s target and warns without rewriting the scope', async (type) => {
    const connection: SavedConnection = {
      id: `${type}-app`, name: 'App', includeDatabases: ['OLD_NAMESPACE'],
      config: { type, host: 'localhost', port: 1972, user: 'user', database: 'APP_DATA' },
    };
    mocks.storeState.connections = [connection];
    mocks.dbGetDatabases.mockResolvedValue({ success: true, data: [{ Database: 'APP_DATA' }] });
    let loaders: ReturnType<typeof useSidebarTreeLoaders> | undefined;
    const Harness = () => {
      loaders = useSidebarTreeLoaders({
        savedQueries: [], tableSortPreference: {}, tableAccessCount: {},
        pinnedSidebarTables: [], pinnedSidebarDatabases: [],
        loadingNodesRef: { current: new Set<string>() }, setConnectionStates: vi.fn(), setLoadedKeys: vi.fn(),
        replaceTreeNodeChildren: mocks.replaceTreeNodeChildren,
        buildRuntimeConfig: (conn) => conn.config, buildJVMRuntimeConfig: (conn) => conn.config,
        buildJVMDiagnosticTreeNodes: () => [], resolveSavedQueryDisplayName: (name) => String(name || ''),
      });
      return null;
    };
    act(() => { renderer = create(<Harness />); });
    await act(async () => { await loaders!.loadDatabases({ key: connection.id, dataRef: connection }); });
    expect(mocks.dbGetDatabases).toHaveBeenCalledWith(expect.objectContaining({ type, database: 'APP_DATA' }));
    const calls = mocks.replaceTreeNodeChildren.mock.calls;
    const children = calls[calls.length - 1]?.[1] as SidebarTreeNode[];
    expect(flatten(children).filter((node) => node.type === 'database').map((node) => node.title)).toEqual(['APP_DATA']);
    expect(mocks.warning).toHaveBeenCalledWith(expect.objectContaining({ content: t('sidebar.message.databases_filtered_by_scope', { count: 1 }) }));
    expect(connection.includeDatabases).toEqual(['OLD_NAMESPACE']);
  });
});
