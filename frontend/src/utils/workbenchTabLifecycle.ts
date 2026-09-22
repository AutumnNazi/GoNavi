import type { TabData } from '../types';

export const shouldDestroyHiddenWorkbenchTab = (
  tab: Pick<TabData, 'id' | 'type'>,
  pendingTransactions: Record<string, unknown> | null | undefined,
  hasPendingResultChanges = false,
): boolean => (
  // The transaction controller treats unmount as tab close and rolls back.
  tab.type === 'query' && !pendingTransactions?.[tab.id] && !hasPendingResultChanges
);

export const shouldBlockWorkbenchTabDetach = (
  tab: Pick<TabData, 'type'>,
  hasPendingResultChanges: boolean,
): boolean => tab.type === 'query' && hasPendingResultChanges;
