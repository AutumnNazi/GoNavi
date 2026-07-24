import { afterEach, describe, expect, it } from 'vitest';

import type { TabData } from '../types';
import { clearQueryTabDraft, setQueryTabDraft } from './sqlFileTabDrafts';
import { resolveLiveQueryTab, resolveLiveQueryTabs } from './liveQueryTabs';

const touchedTabIds = new Set<string>();

const createQueryTab = (id: string, query: string): TabData => ({
  id,
  title: id,
  type: 'query',
  connectionId: 'connection-1',
  query,
});

afterEach(() => {
  touchedTabIds.forEach(clearQueryTabDraft);
  touchedTabIds.clear();
});

describe('live query tab resolution', () => {
  it('overlays the editor draft without mutating the store tab', () => {
    const tab = createQueryTab('live-query-1', 'select stale');
    touchedTabIds.add(tab.id);
    setQueryTabDraft(tab.id, 'select live');

    const liveTab = resolveLiveQueryTab(tab);

    expect(liveTab).toEqual({ ...tab, query: 'select live' });
    expect(liveTab).not.toBe(tab);
    expect(tab.query).toBe('select stale');
  });

  it('keeps references stable when no query draft changes the tab', () => {
    const queryTab = createQueryTab('live-query-2', 'select stable');
    const tableTab: TabData = {
      id: 'table-1',
      title: 'users',
      type: 'table',
      connectionId: 'connection-1',
      tableName: 'users',
    };
    const tabs = [queryTab, tableTab];

    expect(resolveLiveQueryTab(queryTab)).toBe(queryTab);
    expect(resolveLiveQueryTab(tableTab)).toBe(tableTab);
    expect(resolveLiveQueryTabs(tabs)).toBe(tabs);
  });

  it('clones only the drafted query tabs in a live array snapshot', () => {
    const first = createQueryTab('live-query-3', 'select stale');
    const second = createQueryTab('live-query-4', 'select stable');
    const tabs = [first, second];
    touchedTabIds.add(first.id);
    setQueryTabDraft(first.id, 'select live');

    const liveTabs = resolveLiveQueryTabs(tabs);

    expect(liveTabs).not.toBe(tabs);
    expect(liveTabs[0]).toEqual({ ...first, query: 'select live' });
    expect(liveTabs[1]).toBe(second);
  });
});
