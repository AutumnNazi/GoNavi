import { useEffect } from 'react';

import { useStore } from '../../store';
import {
  resolveExplorerFilterFamily,
  resolveExplorerFilterReset,
  type V2ExplorerFilter,
} from './sidebarExplorerFilter';

type ExplorerFilterConnection = { config?: any } | null | undefined;

/**
 * Drop an explorer filter the active connection cannot honour.
 *
 * A stale filter is not cosmetic: the tree is narrowed to the dimensions its
 * filter recognises, so a filter belonging to another workbench family empties the
 * sidebar with no button left to clear it. The rule itself lives in
 * `resolveExplorerFilterReset`, which is pure and unit-tested; this hook only keeps
 * it in step with the active connection and the layout mode — the Navicat layout
 * hides the relational tabs (they duplicate the workbench toolbar), so a relational
 * filter selected under the classic layout must collapse back to `all` on switch.
 *
 * Extracted from Sidebar.tsx, which is past the repo's size limit (AGENTS.md §1.1).
 */
export const useV2ExplorerFilterReset = (
  activeConnection: ExplorerFilterConnection,
  activeFilter: V2ExplorerFilter,
  resetFilter: (filter: V2ExplorerFilter) => void,
): void => {
  const family = resolveExplorerFilterFamily(activeConnection);
  const relationalTabsHidden = useStore(state => state.appearance.uiLayoutMode === 'navicat');
  useEffect(() => {
    const next = resolveExplorerFilterReset(family, activeFilter, activeConnection, { relationalTabsHidden });
    if (next) resetFilter(next);
  }, [family, activeConnection, activeFilter, resetFilter, relationalTabsHidden]);
};
