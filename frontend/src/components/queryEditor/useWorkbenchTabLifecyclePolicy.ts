import { useCallback } from 'react';

import { useStore } from '../../store';
import type { TabData } from '../../types';
import { shouldDestroyHiddenWorkbenchTab } from '../../utils/workbenchTabLifecycle';
import {
  hasQueryEditorPendingResultChanges,
  useQueryEditorPendingResultRevision,
} from './queryEditorPendingResultChanges';

export const useWorkbenchTabLifecyclePolicy = () => {
  const pendingTransactions = useStore((state) => state.sqlEditorPendingTransactions);
  const pendingResultRevision = useQueryEditorPendingResultRevision();
  return useCallback((tab: Pick<TabData, 'id' | 'type'>) => shouldDestroyHiddenWorkbenchTab(
    tab,
    pendingTransactions,
    hasQueryEditorPendingResultChanges(tab.id),
  ), [pendingResultRevision, pendingTransactions]);
};
