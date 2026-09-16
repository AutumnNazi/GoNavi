import type { TabData } from '../types';

export const shouldDestroyHiddenWorkbenchTab = (
  tab: Pick<TabData, 'id' | 'type'>,
  pendingTransactions: Record<string, unknown> | null | undefined,
): boolean => (
  // The transaction controller treats unmount as tab close and rolls back.
  tab.type === 'query' && !pendingTransactions?.[tab.id]
);
