import { describe, expect, it } from 'vitest';
import type { TabData } from '../../types';
import { resolveMockDataLaunchTarget } from './useSidebarMockDataLauncher';

describe('resolveMockDataLaunchTarget', () => {
  const tableTab: TabData = { id: 't', title: 'orders', type: 'table', connectionId: 'c2', dbName: 'shop', tableName: 'orders' };

  it('prefers the selected table node', () => {
    expect(resolveMockDataLaunchTarget(
      { type: 'table', title: 'users', dataRef: { id: 'c1', dbName: 'app', tableName: 'public.users', schemaName: 'public' } },
      tableTab,
    )).toEqual({ connectionId: 'c1', dbName: 'app', tableName: 'public.users', schemaName: 'public' });
  });

  it('falls back to the active table tab and gives up otherwise', () => {
    expect(resolveMockDataLaunchTarget({ type: 'database', title: 'app' }, tableTab)).toMatchObject({ connectionId: 'c2', tableName: 'orders' });
    expect(resolveMockDataLaunchTarget(undefined, { ...tableTab, type: 'query' })).toBeNull();
  });
});
