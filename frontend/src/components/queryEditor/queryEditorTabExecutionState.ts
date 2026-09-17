import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

export type QueryEditorTabExecutionAppearance = 'idle' | 'running' | 'done' | 'error' | 'read';
export type QueryEditorTabExecutionDockAppearance = 'running' | 'done' | 'error';

export type QueryEditorTabExecutionDockEntry = {
  tabId: string;
  appearance: QueryEditorTabExecutionDockAppearance;
};

const appearanceByTabId = new Map<string, QueryEditorTabExecutionAppearance>();
const listeners = new Set<() => void>();
let revision = 0;
let runningSnapshot: readonly string[] = [];
let dockSnapshot: readonly QueryEditorTabExecutionDockEntry[] = [];

export const isQueryEditorTabExecutionDockAppearance = (
  appearance: QueryEditorTabExecutionAppearance,
): appearance is QueryEditorTabExecutionDockAppearance => (
  appearance === 'running' || appearance === 'done' || appearance === 'error'
);

const reuseIdList = (previous: readonly string[], next: string[]): readonly string[] => (
  previous.length === next.length && previous.every((id, index) => id === next[index])
    ? previous
    : next
);

const reuseDockEntries = (
  previous: readonly QueryEditorTabExecutionDockEntry[],
  next: QueryEditorTabExecutionDockEntry[],
): readonly QueryEditorTabExecutionDockEntry[] => (
  previous.length === next.length
    && previous.every((entry, index) => (
      entry.tabId === next[index].tabId && entry.appearance === next[index].appearance
    ))
    ? previous
    : next
);

const refreshSnapshot = () => {
  const runningIds: string[] = [];
  const dockEntries: QueryEditorTabExecutionDockEntry[] = [];
  appearanceByTabId.forEach((appearance, tabId) => {
    if (appearance === 'running') runningIds.push(tabId);
    if (isQueryEditorTabExecutionDockAppearance(appearance)) {
      dockEntries.push({ tabId, appearance });
    }
  });
  runningSnapshot = reuseIdList(runningSnapshot, runningIds);
  dockSnapshot = reuseDockEntries(dockSnapshot, dockEntries);
};

const emitChange = () => {
  revision += 1;
  refreshSnapshot();
  listeners.forEach((listener) => listener());
};

const normalizeTabId = (tabId: string): string => String(tabId || '').trim();

export const subscribeQueryEditorTabExecution = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const resolveQueryEditorTabExecutionAppearance = (
  loading: boolean,
  lifecycleStatus: string,
  current: QueryEditorTabExecutionAppearance,
): QueryEditorTabExecutionAppearance => {
  const status = String(lifecycleStatus || '').trim().toLowerCase();
  if (loading) return 'running';
  if (status === 'done') return current === 'read' ? 'read' : 'done';
  if (status === 'error') return current === 'read' ? 'read' : 'error';
  if (status === 'cancelled') return 'idle';
  if (current === 'running') return 'idle';
  return current;
};

export const getQueryEditorTabExecutionAppearance = (
  tabId: string,
): QueryEditorTabExecutionAppearance => (
  appearanceByTabId.get(normalizeTabId(tabId)) || 'idle'
);

export const setQueryEditorTabExecutionAppearance = (
  tabId: string,
  next: QueryEditorTabExecutionAppearance | ((
    current: QueryEditorTabExecutionAppearance,
  ) => QueryEditorTabExecutionAppearance),
): void => {
  const id = normalizeTabId(tabId);
  if (!id) return;
  const current = getQueryEditorTabExecutionAppearance(id);
  const resolved = typeof next === 'function' ? next(current) : next;
  if (resolved === current) return;
  if (resolved === 'idle') appearanceByTabId.delete(id);
  else appearanceByTabId.set(id, resolved);
  emitChange();
};

export const acknowledgeQueryEditorTabExecution = (tabId: string): void => {
  setQueryEditorTabExecutionAppearance(tabId, (current) => (
    current === 'done' || current === 'error' ? 'read' : current
  ));
};

export const setQueryEditorTabExecuting = (tabId: string, executing: boolean): void => {
  setQueryEditorTabExecutionAppearance(tabId, (current) => (
    executing ? 'running' : (current === 'running' ? 'idle' : current)
  ));
};

/** Forget status for tabs that are no longer open so closed tabs never linger in the dock. */
export const pruneQueryEditorTabExecutionState = (openTabIds: readonly string[]): void => {
  const open = new Set(openTabIds.map(normalizeTabId).filter(Boolean));
  let changed = false;
  Array.from(appearanceByTabId.keys()).forEach((tabId) => {
    if (open.has(tabId)) return;
    appearanceByTabId.delete(tabId);
    changed = true;
  });
  if (changed) emitChange();
};

export const isQueryEditorTabExecuting = (tabId: string): boolean => (
  getQueryEditorTabExecutionAppearance(tabId) === 'running'
);

export const useQueryEditorTabExecutionRevision = (): number => useSyncExternalStore(
  subscribeQueryEditorTabExecution,
  () => revision,
  () => revision,
);

export const useQueryEditorExecutingTabIds = (): readonly string[] => useSyncExternalStore(
  subscribeQueryEditorTabExecution,
  () => runningSnapshot,
  () => runningSnapshot,
);

export const useQueryEditorTabExecutionDockEntries = (): readonly QueryEditorTabExecutionDockEntry[] => (
  useSyncExternalStore(
    subscribeQueryEditorTabExecution,
    () => dockSnapshot,
    () => dockSnapshot,
  )
);

export const useQueryEditorTabExecuting = (tabId: string): boolean => {
  useQueryEditorTabExecutionRevision();
  return isQueryEditorTabExecuting(tabId);
};

export const useQueryEditorTabExecutionAppearance = (
  tabId: string,
): QueryEditorTabExecutionAppearance => {
  const id = normalizeTabId(tabId);
  useQueryEditorTabExecutionRevision();
  return getQueryEditorTabExecutionAppearance(id);
};

export const useQueryEditorTabExecutionOpenTabPrune = (
  tabs: ReadonlyArray<{ id: string }>,
): void => {
  useEffect(() => {
    pruneQueryEditorTabExecutionState(tabs.map((tab) => tab.id));
  }, [tabs]);
};

export const useQueryEditorTabExecutionBroadcast = (
  tabId: string,
  executing: boolean,
  lifecycleStatus = 'idle',
  isActive = false,
): void => {
  useLayoutEffect(() => {
    setQueryEditorTabExecutionAppearance(tabId, (current) => (
      resolveQueryEditorTabExecutionAppearance(executing, lifecycleStatus, current)
    ));
  }, [executing, lifecycleStatus, tabId]);

  useLayoutEffect(() => {
    if (!isActive) return;
    acknowledgeQueryEditorTabExecution(tabId);
  }, [executing, isActive, lifecycleStatus, tabId]);

  // Unmount only clears an in-flight marker; finished dots survive tab remounts.
  useLayoutEffect(() => () => {
    setQueryEditorTabExecutionAppearance(tabId, (current) => (
      current === 'running' ? 'idle' : current
    ));
  }, [tabId]);
};

export const resetQueryEditorTabExecutionStateForTests = (): void => {
  if (appearanceByTabId.size === 0) return;
  appearanceByTabId.clear();
  emitChange();
};
