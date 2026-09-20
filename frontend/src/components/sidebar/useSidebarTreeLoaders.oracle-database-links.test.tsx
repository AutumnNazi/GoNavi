import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedConnection } from '../../types';
import { t } from '../../i18n';
import { useSidebarTreeLoaders } from './useSidebarTreeLoaders';

const mocks = vi.hoisted(() => ({
  dbGetDatabases: vi.fn(),
  dbGetTables: vi.fn(),
  dbRefreshTableStats: vi.fn(),
  dbQuery: vi.fn(),
  getDriverStatusList: vi.fn(),
  jvmProbeCapabilities: vi.fn(),
  replaceTreeNodeChildren: vi.fn(),
  storeState: {
    connections: [] as Array<SavedConnection & { dbName?: string }>,
    tableSortPreference: {} as Record<string, string>,
    tableAccessCount: {} as Record<string, number>,
    pinnedSidebarTables: [] as string[],
    pinnedSidebarDatabases: [] as string[],
  },
}));

vi.mock('antd', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  message: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../store', async () => {
  const actual = await vi.importActual<typeof import('../../store')>('../../store');
  const useStore = Object.assign(vi.fn(), { getState: () => mocks.storeState });
  return { ...actual, useStore };
});

vi.mock('../../../wailsjs/go/app/App', () => ({
  DBGetDatabases: mocks.dbGetDatabases,
  DBGetTables: mocks.dbGetTables,
  DBRefreshTableStats: mocks.dbRefreshTableStats,
  DBQuery: mocks.dbQuery,
  GetDriverStatusList: mocks.getDriverStatusList,
  JVMProbeCapabilities: mocks.jvmProbeCapabilities,
}));

const flatten = (nodes: any[]): any[] => {
  const out: any[] = [];
  const queue = [...(nodes || [])];
  while (queue.length) {
    const node = queue.shift();
    if (!node) continue;
    out.push(node);
    if (Array.isArray(node.children)) queue.push(...node.children);
  }
  return out;
};

const lastTreeChildren = (): any[] => {
  const calls = mocks.replaceTreeNodeChildren.mock.calls;
  return calls[calls.length - 1]?.[1] || [];
};

const isDatabaseLinksSql = (sql: string): boolean => /FROM ALL_DB_LINKS/i.test(sql);

describe('useSidebarTreeLoaders Oracle database links', () => {
  let renderer: ReactTestRenderer | null = null;
  const oracleConnection = {
    id: 'conn-ora',
    name: 'Oracle',
    dbName: 'SCOTT',
    config: { type: 'oracle', host: '127.0.0.1', port: 1521, user: 'scott', database: 'ORCL' },
  } as SavedConnection & { dbName: string };
  const postgresConnection = {
    id: 'conn-pg',
    name: 'Postgres',
    dbName: 'shop',
    config: { type: 'postgres', host: '127.0.0.1', port: 5432, user: 'app', database: 'shop' },
  } as SavedConnection & { dbName: string };

  const mountLoaders = () => {
    let loaders: ReturnType<typeof useSidebarTreeLoaders> | undefined;
    const Harness = () => {
      loaders = useSidebarTreeLoaders({
        savedQueries: [],
        tableSortPreference: {},
        tableAccessCount: {},
        pinnedSidebarTables: [],
        pinnedSidebarDatabases: [],
        loadingNodesRef: { current: new Set<string>() },
        setConnectionStates: vi.fn(),
        setLoadedKeys: vi.fn(),
        replaceTreeNodeChildren: mocks.replaceTreeNodeChildren,
        buildRuntimeConfig: (conn) => conn.config,
        buildJVMRuntimeConfig: (conn) => conn.config,
        buildJVMDiagnosticTreeNodes: () => [],
        resolveSavedQueryDisplayName: (name) => String(name || ''),
      });
      return null;
    };
    act(() => { renderer = create(<Harness />); });
    return () => loaders!;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeState.connections = [oracleConnection, postgresConnection];
    mocks.replaceTreeNodeChildren.mockImplementation((_key, children) => children || []);
    mocks.dbRefreshTableStats.mockResolvedValue({ success: false });
    mocks.dbQuery.mockImplementation(async (_config, _dbName, sql: string) => {
      if (isDatabaseLinksSql(sql)) {
        return {
          success: true,
          data: [
            { SCHEMA_NAME: 'SCOTT', DATABASE_LINK_NAME: 'ORCL.WORLD' },
            { SCHEMA_NAME: 'SCOTT', DATABASE_LINK_NAME: 'FCCS_FCKF222' },
          ],
        };
      }
      return { success: true, data: [] };
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('lists the schema-owned links under a "database links" group for Oracle', async () => {
    mocks.dbGetTables.mockResolvedValue({ success: true, data: [{ Table: 'SCOTT.EMP' }] });
    const getLoaders = mountLoaders();

    await act(async () => {
      await getLoaders().loadTables({ key: 'conn-ora-SCOTT', dataRef: oracleConnection });
    });

    const linkQueries = mocks.dbQuery.mock.calls.filter(([, , sql]) => isDatabaseLinksSql(String(sql)));
    expect(linkQueries).toHaveLength(1);
    expect(String(linkQueries[0][2])).toContain("OWNER = 'SCOTT'");

    const lastCommit = lastTreeChildren();
    const nodes = flatten(lastCommit);
    const group = nodes.find((node) => node.type === 'object-group' && node.dataRef?.groupKey === 'databaseLinks');
    expect(group).toBeDefined();
    expect(group.title).toBe(t('sidebar.object_group.database_links'));
    expect(group.dataRef).toMatchObject({ id: 'conn-ora', dbName: 'SCOTT', schemaName: 'SCOTT' });

    // The group sits next to the other object groups of the same schema.
    const schemaNode = nodes.find((node) => node.dataRef?.groupKey === 'schema' && node.dataRef?.schemaName === 'SCOTT');
    expect(schemaNode?.children?.map((node: any) => node.dataRef?.groupKey)).toContain('databaseLinks');
    expect(schemaNode?.children?.map((node: any) => node.dataRef?.groupKey)).toContain('tables');

    const links = (group.children || []).filter((node: any) => node.type === 'database-link');
    expect(links.map((node: any) => node.title)).toEqual(['FCCS_FCKF222', 'ORCL.WORLD']);
    expect(links.every((node: any) => node.isLeaf)).toBe(true);
    expect(links[1].dataRef).toMatchObject({
      id: 'conn-ora',
      dbName: 'SCOTT',
      schemaName: 'SCOTT',
      databaseLinkName: 'ORCL.WORLD',
    });
    expect(new Set(links.map((node: any) => node.key)).size).toBe(2);
  });

  it('still shows the schema with an empty database links group when the schema owns no objects', async () => {
    mocks.dbGetTables.mockResolvedValue({ success: true, data: [] });
    mocks.dbQuery.mockResolvedValue({ success: true, data: [] });
    const getLoaders = mountLoaders();

    await act(async () => {
      await getLoaders().loadTables({ key: 'conn-ora-SCOTT', dataRef: oracleConnection });
    });

    const nodes = flatten(lastTreeChildren());
    const group = nodes.find((node) => node.type === 'object-group' && node.dataRef?.groupKey === 'databaseLinks');
    expect(group).toBeDefined();
    expect(group.isLeaf).toBe(true);
    expect(group.children).toBeUndefined();
  });

  it('never queries ALL_DB_LINKS or renders the group for non-Oracle connections', async () => {
    mocks.dbGetTables.mockResolvedValue({ success: true, data: [{ Table: 'public.orders' }] });
    const getLoaders = mountLoaders();

    await act(async () => {
      await getLoaders().loadTables({ key: 'conn-pg-shop', dataRef: postgresConnection });
    });

    expect(mocks.dbQuery.mock.calls.some(([, , sql]) => isDatabaseLinksSql(String(sql)))).toBe(false);
    const nodes = flatten(lastTreeChildren());
    expect(nodes.some((node) => node.dataRef?.groupKey === 'databaseLinks')).toBe(false);
    expect(nodes.some((node) => node.type === 'database-link')).toBe(false);
  });
});
