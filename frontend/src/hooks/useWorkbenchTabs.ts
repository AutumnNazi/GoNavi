import { useMemo } from 'react';

import { useStore } from '../store';
import { createWorkbenchTabsSelector } from '../utils/workbenchTabsSelector';

/** Tab state for workbench chrome; editor text remains owned by the editor hot path. */
export const useWorkbenchTabs = () => {
  const selector = useMemo(createWorkbenchTabsSelector, []);
  return useStore(selector);
};
