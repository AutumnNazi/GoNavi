import { describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import type { SidebarTreeNode } from './sidebarV2TreeNodes';
import { buildDatabaseJobGroup, buildDatabaseJobMenuItems, openDatabaseJobDefinition } from './sidebarJobObjects';
import { filterV2ExplorerTreeByKind, resolveExplorerFilterOrder, resolveExplorerFilterReset } from './sidebarExplorerFilter';
import { tryOpenSidebarObjectNode } from './sidebarOpenObjectNode';
import { resolveSidebarTableNameForCopy, resolveSidebarTitlebarObjectName } from './sidebarHelpers';
import { normalizeSidebarLocateObjectRequestFromTab, resolveSidebarLocateTarget, findSidebarNodePathForLocate } from '../../utils/sidebarLocate';
import { sanitizeSidebarHiddenObjectGroups, filterSidebarTreeByHiddenObjectGroups } from '../../utils/sidebarObjectVisibility';
import { toSnapshotTab } from '../../utils/workbenchSessionSnapshot';

const connection: SavedConnection & { dbName: string } = {
  id: 'conn', name: 'Oracle', dbName: 'MiXeD',
  config: { type: 'oracle', host: 'localhost', port: 1521, user: 'APP', database: 'ORCL' },
};
const makeGroup = () => buildDatabaseJobGroup(connection, 'conn-MiXeD', [
  { schemaName: 'MiXeD', jobName: '123', jobKind: 'dbms-job' },
  { schemaName: 'MiXeD', jobName: '123', jobKind: 'oracle-scheduler' },
  { schemaName: 'MiXeD', jobName: 'A.B', jobKind: 'oracle-scheduler' },
]);

describe('job explorer and definition navigation', () => {
  it('keeps source identities distinct while filtering jobs as one object kind', () => {
    const group = makeGroup();
    expect(new Set(group.children?.map((node) => node.key)).size).toBe(3);
    const tree: SidebarTreeNode[] = [{
      type: 'database', title: 'MiXeD', key: 'conn-MiXeD', children: [
        group, { type: 'object-group', title: 'Tables', key: 'tables', dataRef: { groupKey: 'tables' } },
      ],
    }];
    expect(filterV2ExplorerTreeByKind(tree, 'jobs')[0].children).toEqual([group]);
  });

  it('keeps dotted job names intact in tabs and copied names', () => {
    const node = makeGroup().children![2];
    const addTab = vi.fn<(tab: TabData) => void>();
    openDatabaseJobDefinition(node, addTab);
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      type: 'job-def', jobName: 'A.B', schemaName: 'MiXeD', jobKind: 'oracle-scheduler', sidebarLocateKey: node.key,
    }));
    expect(resolveSidebarTableNameForCopy(node)).toBe('A.B');
    expect(resolveSidebarTitlebarObjectName(node)).toBe('A.B');
  });

  it('opens a read-only definition through the existing double-click dispatcher', () => {
    const addTab = vi.fn();
    expect(tryOpenSidebarObjectNode(makeGroup().children![0], {
      addTab, openEventDefinition: vi.fn(), openSequenceDefinition: vi.fn(), openPackageDefinition: vi.fn(),
      t: (key) => key, buildOptionalSchemaContext: () => ({}),
    })).toBe(true);
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ type: 'job-def', jobKind: 'dbms-job' }));
  });

  it('offers management alongside view/copy and refreshes the owning database', () => {
    const group = makeGroup();
    const context = {
      addTab: vi.fn(), handleCopyTableName: vi.fn(),
      loadTables: vi.fn(async () => undefined),
      getDatabaseNodeRef: vi.fn((connRef: SavedConnection, dbName: string) => ({
        key: `${connRef.id}-${dbName}`, type: 'database', dataRef: { ...connRef, dbName },
      })),
    };
    const items = buildDatabaseJobMenuItems(makeGroup().children![0], context);
    expect(items?.map((item) => item?.key)).toEqual(['view-job-def', 'manage-job', 'copy-job-name']);
    const groupItems = buildDatabaseJobMenuItems(group, context);
    expect(groupItems?.map(item => item?.key)).toContain('create-job-oracle-scheduler');
    const refresh = groupItems?.find(item => item?.key === 'refresh-jobs');
    if (refresh && 'onClick' in refresh) refresh.onClick?.({} as never);
    expect(context.getDatabaseNodeRef).toHaveBeenCalledWith(group.dataRef, 'MiXeD');
    expect(context.loadTables).toHaveBeenCalledWith(expect.objectContaining({
      key: 'conn-MiXeD', dataRef: expect.objectContaining({ config: connection.config, dbName: 'MiXeD' }),
    }), { ensureFresh: true });
  });

  it('shows the job filter only for supported sources and clears it when changing engine', () => {
    expect(resolveExplorerFilterOrder('relational', connection)).toContain('jobs');
    const mysql = { ...connection, config: { ...connection.config, type: 'mysql' } };
    expect(resolveExplorerFilterOrder('relational', mysql)).not.toContain('jobs');
    expect(resolveExplorerFilterReset('relational', 'jobs', mysql)).toBe('all');
    expect(resolveExplorerFilterReset('relational', 'jobs', connection)).toBeNull();
  });

  it('honours object-group visibility preferences', () => {
    expect(sanitizeSidebarHiddenObjectGroups(['jobs', 'unknown', 'jobs'])).toEqual(['jobs']);
    expect(filterSidebarTreeByHiddenObjectGroups([makeGroup()], ['jobs'])).toEqual([]);
  });

  it('restores the source identity and locates the correct same-named job', () => {
    const addTab = vi.fn<(tab: TabData) => void>();
    openDatabaseJobDefinition(makeGroup().children![1], addTab);
    const snapshot = toSnapshotTab(addTab.mock.calls[0][0]);
    expect(snapshot).toMatchObject({ jobName: '123', jobKind: 'oracle-scheduler' });
    const request = normalizeSidebarLocateObjectRequestFromTab({ ...snapshot!, sidebarLocateKey: 'old-key' });
    if (!request) throw new Error('expected a locate request');
    const target = resolveSidebarLocateTarget(request, { groupBySchema: false });
    const tree: SidebarTreeNode[] = [{
      key: 'conn', type: 'connection', title: 'Oracle', children: [{
        key: 'conn-MiXeD', type: 'database', title: 'MiXeD', children: [makeGroup()],
      }],
    }];
    const path = findSidebarNodePathForLocate(tree, target);
    expect(path?.[path.length - 1]).toBe(makeGroup().children![1].key);
  });

  it('does not split or case-fold the names of quoted job objects during locate', () => {
    const group = makeGroup();
    const addTab = vi.fn<(tab: TabData) => void>();
    openDatabaseJobDefinition(group.children![2], addTab);
    const request = normalizeSidebarLocateObjectRequestFromTab(addTab.mock.calls[0][0]);
    expect(request).toMatchObject({ objectGroup: 'jobs', tableName: 'A.B', schemaName: 'MiXeD' });
    expect(toSnapshotTab({ ...addTab.mock.calls[0][0], jobKind: 'bogus' })?.jobKind).toBeUndefined();
  });
});
