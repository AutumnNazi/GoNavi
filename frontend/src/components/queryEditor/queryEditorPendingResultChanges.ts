import { useSyncExternalStore } from 'react';

const pendingTabIds = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;

const emitChange = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};

export const setQueryEditorPendingResultChanges = (tabId: string, pending: boolean): void => {
  const id = String(tabId || '').trim();
  if (!id) return;
  const changed = pending ? !pendingTabIds.has(id) : pendingTabIds.has(id);
  if (!changed) return;
  if (pending) pendingTabIds.add(id);
  else pendingTabIds.delete(id);
  emitChange();
};

export const hasQueryEditorPendingResultChanges = (tabId: string): boolean => (
  pendingTabIds.has(String(tabId || '').trim())
);

export const useQueryEditorPendingResultRevision = (): number => useSyncExternalStore(
  (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => revision,
  () => revision,
);
