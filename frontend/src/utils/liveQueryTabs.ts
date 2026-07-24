import type { TabData } from '../types';
import { getQueryTabDraft } from './sqlFileTabDrafts';

export const resolveLiveQueryTab = (tab: TabData): TabData => {
  if (tab.type !== 'query') return tab;
  const storedQuery = typeof tab.query === 'string' ? tab.query : '';
  const liveQuery = getQueryTabDraft(tab.id, storedQuery);
  return liveQuery === storedQuery ? tab : { ...tab, query: liveQuery };
};

export const resolveLiveQueryTabs = (tabs: TabData[]): TabData[] => {
  let resolved: TabData[] | null = null;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const liveTab = resolveLiveQueryTab(tab);
    if (!resolved && liveTab !== tab) {
      resolved = tabs.slice(0, index);
    }
    resolved?.push(liveTab);
  }
  return resolved || tabs;
};
