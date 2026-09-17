import type { QueryEditorResultSet } from '../components/QueryEditorResultsPanel';

export type QueryEditorResultSessionSnapshot = {
  resultSets: QueryEditorResultSet[];
  activeResultKey: string;
  isResultPanelVisible?: boolean;
};

const cache = new Map<string, QueryEditorResultSessionSnapshot>();
const listeners = new Map<string, Set<(snapshot: QueryEditorResultSessionSnapshot | null) => void>>();

const notifyQueryEditorResultSession = (
  tabId: string,
  snapshot: QueryEditorResultSessionSnapshot | null,
): void => {
  listeners.get(tabId)?.forEach((listener) => listener(snapshot));
};

export const saveQueryEditorResultSession = (
  tabId: string,
  snapshot: QueryEditorResultSessionSnapshot,
): void => {
  const id = String(tabId || '').trim();
  if (!id) return;
  const nextSnapshot = {
    resultSets: Array.isArray(snapshot.resultSets) ? snapshot.resultSets : [],
    activeResultKey: String(snapshot.activeResultKey || ''),
    isResultPanelVisible: snapshot.isResultPanelVisible,
  };
  cache.set(id, nextSnapshot);
  notifyQueryEditorResultSession(id, nextSnapshot);
};

export const takeQueryEditorResultSession = (
  tabId: string,
): QueryEditorResultSessionSnapshot | null => {
  const id = String(tabId || '').trim();
  if (!id) return null;
  const snapshot = cache.get(id) || null;
  if (snapshot) {
    cache.delete(id);
    notifyQueryEditorResultSession(id, null);
  }
  return snapshot;
};

export const peekQueryEditorResultSession = (
  tabId: string,
): QueryEditorResultSessionSnapshot | null => {
  const id = String(tabId || '').trim();
  if (!id) return null;
  return cache.get(id) || null;
};

export const clearQueryEditorResultSession = (tabId: string): void => {
  const id = String(tabId || '').trim();
  if (!id) return;
  cache.delete(id);
  notifyQueryEditorResultSession(id, null);
};

export const subscribeQueryEditorResultSession = (
  tabId: string,
  listener: (snapshot: QueryEditorResultSessionSnapshot | null) => void,
): (() => void) => {
  const id = String(tabId || '').trim();
  if (!id) return () => undefined;
  const tabListeners = listeners.get(id) || new Set();
  tabListeners.add(listener);
  listeners.set(id, tabListeners);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(id);
    }
  };
};
