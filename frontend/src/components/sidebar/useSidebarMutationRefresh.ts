import { useEffect, useRef } from 'react';
import type { Key } from 'react';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import type { SidebarLoadedTableEntry, SidebarTreeLoadOptions } from './sidebarTreeLoaderHelpers';
import type { UseSidebarTreeLoadersOptions } from './useSidebarTreeLoaders';
import { matchSidebarRowCountTables, refreshSidebarTableRowCounts, sidebarTableCountIdentity } from './sidebarTableRowCounts';

type Connection = SavedConnection & { dbName: string };
type LoadNode = { key: Key; dataRef?: unknown; type?: string };
type Loader = (node: LoadNode, options?: SidebarTreeLoadOptions) => Promise<void>;
type Input = Pick<UseSidebarTreeLoadersOptions, 'getTree' | 'replaceTreeNodeChildren'>;
type Refresh = {
  connection: Connection;
  controller: AbortController;
  counts: Map<string, number>;
  removed: Set<string>;
  pending: Map<string, { target: string; schemaName?: string }>;
};
const scopeKey = (connection: Connection) => JSON.stringify([connection.id, connection.dbName]);
const flatten = (nodes: SidebarTreeNode[]): SidebarTreeNode[] => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
const entriesFor = (nodes: SidebarTreeNode[], connection: Connection): SidebarLoadedTableEntry[] => {
  const entries = new Map<string, SidebarLoadedTableEntry>();
  for (const node of flatten(nodes)) {
    const ref = node.dataRef;
    if (node.type !== 'table' || ref?.id !== connection.id || ref?.dbName !== connection.dbName || !ref.tableName) continue;
    const entry = { tableName: String(ref.tableName), schemaName: String(ref.schemaName || ''), displayName: String(ref.tableName) };
    entries.set(sidebarTableCountIdentity(entry.tableName, entry.schemaName), entry);
  }
  return [...entries.values()];
};

// Object discovery owns the loading indicator. Exact counts run separately and
// only patch still-present table nodes, never replay a captured database subtree.
export function useSidebarMutationRefresh(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const requests = useRef(new Map<string, Refresh>());
  const tree = useRef<SidebarTreeNode[]>([]);
  const readTree = () => latest.current.getTree?.() || tree.current;
  useEffect(() => () => {
    for (const request of requests.current.values()) request.controller.abort();
    requests.current.clear();
  }, []);

  const decorate = (nodes: SidebarTreeNode[]): SidebarTreeNode[] => {
    let changed = false;
    const result = nodes.flatMap(node => {
      const ref = node.dataRef;
      const request = ref?.id ? requests.current.get(scopeKey(ref as Connection)) : undefined;
      const identity = ref?.tableName ? sidebarTableCountIdentity(ref.tableName, ref.schemaName || '') : '';
      if (request?.removed.has(identity)) { changed = true; return []; }
      const count = request?.counts.get(identity);
      const children = node.children ? decorate(node.children) : node.children;
      if ((count === undefined || count === ref?.rowCount) && children === node.children) return [node];
      changed = true;
      return [{ ...node, ...(count !== undefined ? { dataRef: { ...ref, rowCount: count } } : {}),
        ...(children ? { children } : {}) }];
    });
    return changed ? result : nodes;
  };
  const replaceTreeNodeChildren: Input['replaceTreeNodeChildren'] = (key, children, dataRef) => {
    const result = latest.current.replaceTreeNodeChildren(key, children ? decorate(children) : children, dataRef);
    tree.current = result;
    return result;
  };
  const publish = (request: Refresh) => {
    const database = flatten(readTree()).find(node => node.type === 'database'
      && node.dataRef?.id === request.connection.id && node.dataRef?.dbName === request.connection.dbName);
    if (database?.children) replaceTreeNodeChildren(database.key, database.children, database.dataRef);
  };
  const invalidate = (connectionId: string) => {
    for (const [key, request] of requests.current) {
      if (request.connection.id !== connectionId) continue;
      request.controller.abort();
      requests.current.delete(key);
    }
  };

  const refresh = async (node: LoadNode, options: SidebarTreeLoadOptions, load: Loader): Promise<void> => {
    const connection = node.dataRef as Connection | undefined;
    if (!connection?.id || options.savedQueriesOnly) return load(node, options);
    const key = scopeKey(connection);
    const previous = requests.current.get(key);
    previous?.controller.abort();
    const mutation = !!(options.rowCountTables?.length || options.clearedTables?.length || options.droppedTables?.length);
    if (!mutation) {
      requests.current.delete(key);
      return load(node, options);
    }
    const request: Refresh = {
      connection, controller: new AbortController(), counts: new Map(previous?.counts), removed: new Set(previous?.removed),
      pending: new Map(previous?.pending),
    };
    for (const target of options.rowCountTables || []) {
      request.pending.set(JSON.stringify([options.schemaName, target]), { target, schemaName: options.schemaName });
    }
    const entries = entriesFor(readTree(), connection);
    const identities = (tables: string[]) => matchSidebarRowCountTables(connection, entries, tables, options.schemaName)
      .map(table => sidebarTableCountIdentity(table.entry.tableName, table.entry.schemaName));
    for (const identity of identities(options.rowCountTables || [])) { request.counts.delete(identity); request.removed.delete(identity); }
    for (const identity of identities(options.clearedTables || [])) request.counts.set(identity, 0);
    for (const identity of identities(options.droppedTables || [])) { request.removed.add(identity); request.counts.delete(identity); }
    requests.current.set(key, request);
    publish(request);
    await load(node, options);
    if (requests.current.get(key) !== request || request.controller.signal.aborted) return;
    publish(request);
    const currentEntries = entriesFor(readTree(), connection).filter(entry => {
      const identity = sidebarTableCountIdentity(entry.tableName, entry.schemaName);
      return !request.removed.has(identity) && !request.counts.has(identity);
    });
    // Deliberately not awaited: large COUNT(*) must not hold the tree's refresh queue.
    void (async () => {
      for (const [pendingKey, target] of request.pending) {
        if (request.controller.signal.aborted) return;
        await refreshSidebarTableRowCounts(connection, currentEntries, [target.target], target.schemaName, {
          signal: request.controller.signal,
          onCount: counts => {
            if (requests.current.get(key) !== request || request.controller.signal.aborted) return;
            for (const [identity, count] of counts) request.counts.set(identity, count);
            publish(request);
          },
        });
        request.pending.delete(pendingKey);
      }
    })().catch(error => {
      if (!request.controller.signal.aborted) console.warn('GoNavi sidebar count refresh failed', error);
    });
  };
  return { refresh, replaceTreeNodeChildren, invalidate };
}
