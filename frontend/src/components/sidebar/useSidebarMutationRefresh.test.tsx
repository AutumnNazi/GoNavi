import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import { useSidebarMutationRefresh } from './useSidebarMutationRefresh';

const backend = vi.hoisted(() => ({ query: vi.fn(), cancel: vi.fn() }));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQueryApplicationWithCancel: backend.query, CancelQuery: backend.cancel }));
const conn = { id: 'c', dbName: 'db', name: 'db', config: { type: 'mysql', queryTimeout: 0 } } as SavedConnection & { dbName: string };
const table = (name: string, rows: number): SidebarTreeNode => ({ key: name, type: 'table', title: name,
  dataRef: { ...conn, tableName: name, schemaName: '', rowCount: rows } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
};
let tree: SidebarTreeNode[];
let api: ReturnType<typeof useSidebarMutationRefresh>;
let renderer: ReactTestRenderer;
const rows = (name = 'orders') => tree[0].children?.find(node => node.key === name)?.dataRef.rowCount;
const replace = (key: React.Key, children: SidebarTreeNode[] | undefined, dataRef?: unknown) => {
  const visit = (nodes: SidebarTreeNode[]): SidebarTreeNode[] => nodes.map(node => node.key === key
    ? { ...node, children, ...(dataRef ? { dataRef } : {}) }
    : { ...node, ...(node.children ? { children: visit(node.children) } : {}) });
  tree = visit(tree);
  return tree;
};
const metadataLoad = async () => { api.replaceTreeNodeChildren('db', [table('orders', 100), table('other', 5)], conn); };
function Harness() {
  api = useSidebarMutationRefresh({ getTree: () => tree, replaceTreeNodeChildren: replace });
  return null;
}
beforeEach(() => {
  backend.query.mockReset(); backend.cancel.mockReset().mockResolvedValue({ success: true });
  tree = [{ key: 'db', type: 'database', title: 'db', dataRef: conn, children: [table('orders', 100), table('other', 5)] }];
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => act(() => renderer.unmount()));

describe('internal mutation sidebar refresh', () => {
  it('releases metadata refresh before a large count completes, then publishes its count', async () => {
    const count = deferred<{ success: boolean; data: { table_rows: number }[] }>();
    backend.query.mockReturnValue(count.promise);
    await api.refresh(tree[0], { ensureFresh: true, rowCountTables: ['orders'] }, metadataLoad);
    expect(backend.query).toHaveBeenCalledOnce();
    expect(backend.query.mock.calls[0][0].queryTimeout).toBe(0);
    expect(rows()).toBe(100);
    count.resolve({ success: true, data: [{ table_rows: 101 }] });
    await count.promise; await Promise.resolve();
    expect(rows()).toBe(101);
  });

  it('sets a cleared table to zero immediately and rejects an older in-flight count', async () => {
    const count = deferred<{ success: boolean; data: { table_rows: number }[] }>();
    backend.query.mockReturnValue(count.promise);
    await api.refresh(tree[0], { rowCountTables: ['orders'] }, metadataLoad);
    const metadata = deferred<void>();
    const refresh = api.refresh(tree[0], { ensureFresh: true, clearedTables: ['orders'] }, () => metadata.promise.then(metadataLoad));
    expect(rows()).toBe(0);
    expect(backend.cancel).toHaveBeenCalledWith(backend.query.mock.calls[0][3]);
    metadata.resolve(); await refresh;
    expect(rows()).toBe(0);
    count.resolve({ success: true, data: [{ table_rows: 1000 }] });
    await count.promise; await Promise.resolve();
    expect(rows()).toBe(0);
    expect(backend.query).toHaveBeenCalledOnce();
  });

  it('removes a dropped table immediately without restoring it from stale metadata', async () => {
    const metadata = deferred<void>();
    const refresh = api.refresh(tree[0], { droppedTables: ['orders'] }, () => metadata.promise.then(metadataLoad));
    expect(rows()).toBeUndefined();
    expect(tree[0].children).toHaveLength(1);
    metadata.resolve(); await refresh;
    expect(rows()).toBeUndefined();
    expect(backend.query).not.toHaveBeenCalled();
  });

  it('retains pending targets from consecutive writes and never counts unrelated tables', async () => {
    const old = deferred<{ success: boolean; data: { table_rows: number }[] }>();
    backend.query.mockReturnValueOnce(old.promise).mockResolvedValue({ success: true, data: [{ table_rows: 9 }] });
    await api.refresh(tree[0], { rowCountTables: ['orders'] }, metadataLoad);
    await api.refresh(tree[0], { rowCountTables: ['other'] }, metadataLoad);
    await Promise.resolve(); await Promise.resolve();
    expect(backend.query.mock.calls.map(call => call[2])).toEqual([
      'SELECT COUNT(*) AS table_rows FROM `orders`', 'SELECT COUNT(*) AS table_rows FROM `orders`',
      'SELECT COUNT(*) AS table_rows FROM `other`',
    ]);
    expect(rows()).toBe(9); expect(rows('other')).toBe(9);
    old.resolve({ success: true, data: [{ table_rows: 999 }] });
    await old.promise; await Promise.resolve();
    expect(rows()).toBe(9);
  });

  it('cancels counts on disconnect and does not recreate a removed database', async () => {
    const count = deferred<{ success: boolean; data: { table_rows: number }[] }>();
    backend.query.mockReturnValue(count.promise);
    await api.refresh(tree[0], { rowCountTables: ['orders'] }, metadataLoad);
    api.invalidate('c'); tree = [];
    count.resolve({ success: true, data: [{ table_rows: 999 }] });
    await count.promise; await Promise.resolve();
    expect(tree).toEqual([]); expect(backend.cancel).toHaveBeenCalledOnce();
  });
});
