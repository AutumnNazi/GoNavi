import React, { useRef } from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../../store';
import type { TabData } from '../../types';
import {
  clearQueryEditorResultSession,
  peekQueryEditorResultSession,
  saveQueryEditorResultSession,
  saveQueryEditorResultSessionForOpenTab,
  type QueryEditorResultSessionSnapshot,
} from '../../utils/queryEditorResultSessionCache';
import { useQueryEditorResultSessionUnmount } from './queryEditorResultSessionLifecycle';

const buildQueryTab = (
  id: string,
  connectionId = 'conn-1',
  dbName = 'main',
): TabData => ({
  id,
  title: id,
  type: 'query',
  connectionId,
  dbName,
  query: `select '${id}'`,
});

const buildSnapshot = (tabId: string): QueryEditorResultSessionSnapshot => ({
  activeResultKey: `result-${tabId}`,
  isResultPanelVisible: true,
  resultSets: [{
    key: `result-${tabId}`,
    sql: `select '${tabId}'`,
    rows: [{ tabId }],
    columns: ['tabId'],
    pkColumns: [],
    readOnly: true,
  }],
});

const ResultSessionLifecycleHarness: React.FC<{
  tabId: string;
  snapshot: QueryEditorResultSessionSnapshot;
}> = ({ tabId, snapshot }) => {
  const resultSetsRef = useRef(snapshot.resultSets);
  const activeResultKeyRef = useRef(snapshot.activeResultKey);
  const isResultPanelVisibleRef = useRef(snapshot.isResultPanelVisible === true);
  resultSetsRef.current = snapshot.resultSets;
  activeResultKeyRef.current = snapshot.activeResultKey;
  isResultPanelVisibleRef.current = snapshot.isResultPanelVisible === true;
  useQueryEditorResultSessionUnmount({
    tabId,
    resultSetsRef,
    activeResultKeyRef,
    isResultPanelVisibleRef,
  });
  return null;
};

const ResultSessionLifecycleHost: React.FC = () => {
  const tabs = useStore((state) => state.tabs);
  const detachedWorkbenchWindows = useStore((state) => state.detachedWorkbenchWindows);
  const detachedIds = new Set(detachedWorkbenchWindows.map((item) => item.tabId));
  return (
    <>
      {tabs
        .filter((tab) => tab.type === 'query' && !detachedIds.has(tab.id))
        .map((tab) => (
          <ResultSessionLifecycleHarness
            key={tab.id}
            tabId={tab.id}
            snapshot={buildSnapshot(tab.id)}
          />
        ))}
    </>
  );
};

type CloseScenario = {
  name: string;
  tabs: TabData[];
  close: () => void;
  closedIds: string[];
  keptIds: string[];
};

const scenarios: CloseScenario[] = [
  {
    name: 'closeTab',
    tabs: [buildQueryTab('keep-single'), buildQueryTab('close-single')],
    close: () => useStore.getState().closeTab('close-single'),
    closedIds: ['close-single'],
    keptIds: ['keep-single'],
  },
  {
    name: 'closeOtherTabs',
    tabs: [buildQueryTab('close-other-left'), buildQueryTab('keep-other'), buildQueryTab('close-other-right')],
    close: () => useStore.getState().closeOtherTabs('keep-other'),
    closedIds: ['close-other-left', 'close-other-right'],
    keptIds: ['keep-other'],
  },
  {
    name: 'closeTabsToLeft',
    tabs: [buildQueryTab('close-left-a'), buildQueryTab('close-left-b'), buildQueryTab('keep-left')],
    close: () => useStore.getState().closeTabsToLeft('keep-left'),
    closedIds: ['close-left-a', 'close-left-b'],
    keptIds: ['keep-left'],
  },
  {
    name: 'closeTabsToRight',
    tabs: [buildQueryTab('keep-right'), buildQueryTab('close-right-a'), buildQueryTab('close-right-b')],
    close: () => useStore.getState().closeTabsToRight('keep-right'),
    closedIds: ['close-right-a', 'close-right-b'],
    keptIds: ['keep-right'],
  },
  {
    name: 'closeTabsByConnection',
    tabs: [
      buildQueryTab('close-connection-a', 'conn-close', 'main'),
      buildQueryTab('close-connection-b', 'conn-close', 'analytics'),
      buildQueryTab('keep-connection', 'conn-keep', 'main'),
    ],
    close: () => useStore.getState().closeTabsByConnection('conn-close'),
    closedIds: ['close-connection-a', 'close-connection-b'],
    keptIds: ['keep-connection'],
  },
  {
    name: 'closeTabsByDatabase',
    tabs: [
      buildQueryTab('close-database', 'conn-db', 'main'),
      buildQueryTab('keep-other-database', 'conn-db', 'analytics'),
      buildQueryTab('keep-other-connection', 'conn-keep', 'main'),
    ],
    close: () => useStore.getState().closeTabsByDatabase('conn-db', 'main'),
    closedIds: ['close-database'],
    keptIds: ['keep-other-database', 'keep-other-connection'],
  },
  {
    name: 'closeAllTabs',
    tabs: [buildQueryTab('close-all-a'), buildQueryTab('close-all-b')],
    close: () => useStore.getState().closeAllTabs(),
    closedIds: ['close-all-a', 'close-all-b'],
    keptIds: [],
  },
];

const allTabIds = scenarios.flatMap(({ tabs }) => tabs.map((tab) => tab.id));
let renderers: ReactTestRenderer[] = [];

const mountScenario = (tabs: TabData[]): void => {
  useStore.setState({
    tabs,
    activeTabId: tabs[0]?.id || null,
    activeContext: null,
    detachedWorkbenchWindows: [],
    detachedQueryResultWindows: tabs.map((tab, index) => ({
      id: `query-result:${tab.id}:result-${tab.id}`,
      sourceQueryTabId: tab.id,
      connectionId: tab.connectionId,
      dbName: tab.dbName,
      title: tab.title,
      result: buildSnapshot(tab.id).resultSets[0],
      x: 40 + index * 10,
      y: 40 + index * 10,
      width: 800,
      height: 600,
      zIndex: 1301 + index,
    })),
  });
  act(() => {
    renderers = [TestRenderer.create(<ResultSessionLifecycleHost />)];
  });
  tabs.forEach((tab) => saveQueryEditorResultSession(tab.id, buildSnapshot(tab.id)));
};

describe('query editor result session lifecycle', () => {
  beforeEach(() => {
    renderers = [];
    allTabIds.forEach(clearQueryEditorResultSession);
    useStore.setState({
      tabs: [],
      activeTabId: null,
      activeContext: null,
      detachedWorkbenchWindows: [],
      detachedQueryResultWindows: [],
    });
  });

  afterEach(() => {
    act(() => {
      renderers.forEach((renderer) => renderer.unmount());
    });
    renderers = [];
    allTabIds.forEach(clearQueryEditorResultSession);
  });

  it.each(scenarios)('does not restore closed sessions after $name unmount cleanup', (scenario) => {
    mountScenario(scenario.tabs);

    act(() => scenario.close());
    scenario.closedIds.forEach((tabId) => {
      expect(peekQueryEditorResultSession(tabId)).toBeNull();
      expect(useStore.getState().detachedWorkbenchWindows.some((item) => item.tabId === tabId)).toBe(false);
      expect(useStore.getState().detachedQueryResultWindows.some((item) => item.sourceQueryTabId === tabId)).toBe(false);
    });
    scenario.keptIds.forEach((tabId) => {
      expect(peekQueryEditorResultSession(tabId)).toEqual(buildSnapshot(tabId));
    });
  });

  it('preserves the result session when detach unmounts an open query tab', () => {
    const tab = buildQueryTab('detach-open');
    allTabIds.push(tab.id);
    mountScenario([tab]);
    clearQueryEditorResultSession(tab.id);

    act(() => useStore.getState().detachWorkbenchTab(tab.id));

    expect(useStore.getState().tabs.some((item) => item.id === tab.id)).toBe(true);
    expect(peekQueryEditorResultSession(tab.id)).toEqual(buildSnapshot(tab.id));
  });

  it('does not retain result sessions after repeatedly closing many query tabs', () => {
    const tabs = Array.from({ length: 20 }, (_, index) => buildQueryTab(`bulk-${index + 1}`));
    allTabIds.push(...tabs.map((tab) => tab.id));
    mountScenario(tabs);

    act(() => useStore.getState().closeAllTabs());

    expect(useStore.getState().tabs).toEqual([]);
    tabs.forEach((tab) => {
      expect(peekQueryEditorResultSession(tab.id)).toBeNull();
    });
  });

  it('rejects a delayed detached-window session after the source tab closes', () => {
    const tab = buildQueryTab('late-detached-sync');
    allTabIds.push(tab.id);
    useStore.setState({ tabs: [tab], activeTabId: tab.id });
    useStore.getState().closeTab(tab.id);

    expect(saveQueryEditorResultSessionForOpenTab(
      tab.id,
      buildSnapshot(tab.id),
      useStore.getState().tabs,
    )).toBe(false);
    expect(peekQueryEditorResultSession(tab.id)).toBeNull();
  });
});
