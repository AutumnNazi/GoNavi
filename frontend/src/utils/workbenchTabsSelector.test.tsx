import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStoreHook } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import {
  areWorkbenchTabsEqualIgnoringQuery,
  createWorkbenchTabsSelector,
  selectWorkbenchTabs,
} from './workbenchTabsSelector';

type TabsState = {
  tabs: TabData[];
};

const createQueryTab = (overrides: Partial<TabData> = {}): TabData => ({
  id: 'query-1',
  title: 'Query 1',
  type: 'query',
  connectionId: 'connection-1',
  dbName: 'database-1',
  query: 'select 1',
  ...overrides,
});

describe('workbench tabs selector', () => {
  it('suppresses 1000 query-only subscription notifications', () => {
    const store = createStore(
      subscribeWithSelector<TabsState>(() => ({ tabs: [createQueryTab()] })),
    );
    const listener = vi.fn();
    const unsubscribe = store.subscribe(selectWorkbenchTabs, listener, {
      equalityFn: areWorkbenchTabsEqualIgnoringQuery,
    });

    for (let index = 0; index < 1000; index += 1) {
      store.setState((state) => ({
        tabs: [{ ...state.tabs[0], query: `select ${index}` }],
      }));
    }

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps one chrome render across 1000 query-only updates', () => {
    const useTestStore = createStoreHook<TabsState>(() => ({ tabs: [createQueryTab()] }));
    let renderCount = 0;

    const ChromeProbe = () => {
      const selector = React.useMemo(createWorkbenchTabsSelector, []);
      useTestStore(selector);
      renderCount += 1;
      return null;
    };

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<ChromeProbe />);
    });
    for (let index = 0; index < 1000; index += 1) {
      act(() => {
        useTestStore.setState((state) => ({
          tabs: [{ ...state.tabs[0], query: `select ${index}` }],
        }));
      });
    }

    expect(renderCount).toBe(1);
    act(() => renderer.unmount());
  });

  it('notifies for metadata, future own fields, tab order, and tab count changes', () => {
    const first = createQueryTab();
    const second = createQueryTab({ id: 'query-2', title: 'Query 2' });
    const store = createStore(
      subscribeWithSelector<TabsState>(() => ({ tabs: [first, second] })),
    );
    const listener = vi.fn();
    const unsubscribe = store.subscribe(selectWorkbenchTabs, listener, {
      equalityFn: areWorkbenchTabsEqualIgnoringQuery,
    });

    store.setState((state) => ({
      tabs: [{ ...state.tabs[0], title: 'Renamed' }, state.tabs[1]],
    }));
    store.setState((state) => ({
      tabs: [
        { ...state.tabs[0], futureMetadata: 'future' } as TabData,
        state.tabs[1],
      ],
    }));
    store.setState((state) => ({
      tabs: [
        { ...state.tabs[0], futureMetadata: 'future-next' } as TabData,
        state.tabs[1],
      ],
    }));
    store.setState((state) => ({ tabs: [state.tabs[1], state.tabs[0]] }));
    store.setState((state) => ({ tabs: [...state.tabs, createQueryTab({ id: 'query-3' })] }));

    expect(listener).toHaveBeenCalledTimes(5);
    unsubscribe();
  });

  it('notifies when result visibility or format restore metadata changes', () => {
    const first = [createQueryTab()];
    const visibilityChanged = [{ ...first[0], resultPanelVisible: true }];
    const restoreChanged = [{
      ...visibilityChanged[0],
      formatRestoreSnapshot: { query: 'select 1', createdAt: 1 },
    }];

    expect(areWorkbenchTabsEqualIgnoringQuery(first, visibilityChanged)).toBe(false);
    expect(areWorkbenchTabsEqualIgnoringQuery(visibilityChanged, restoreChanged)).toBe(false);
  });

  it('ignores adding or removing only the query own field', () => {
    const withQuery = [createQueryTab()];
    const { query: _query, ...withoutQueryTab } = withQuery[0];

    expect(areWorkbenchTabsEqualIgnoringQuery(withQuery, [withoutQueryTab])).toBe(true);
  });
});
