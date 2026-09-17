import { useDeferredValue } from 'react';

import { useStore } from '../store';

/**
 * Resolves whether a docked workbench tab is the active one.
 *
 * `activeTabId` updates are synchronous (zustand → useSyncExternalStore), so the tab
 * bar highlight and antd pane visibility commit right away. The `isActive` flip for
 * the pane content is deferred on purpose: QueryEditor and DataGrid re-render every
 * table cell, tooltip and toolbar item when it changes, and doing that inside the
 * click's synchronous commit is what froze tab switching for hundreds of milliseconds
 * in WebKit. Deferring lets React paint the switch first and run the heavy re-render as
 * interruptible concurrent work.
 *
 * Callers that own the activation state (detached windows) pass `explicit` and keep
 * the immediate value.
 */
export const useWorkbenchTabActivation = (tabId: string, explicit?: boolean): boolean => {
  const fromStore = useStore((state) => state.activeTabId === tabId);
  const deferredFromStore = useDeferredValue(fromStore);
  return explicit ?? deferredFromStore;
};
