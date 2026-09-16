/** @vitest-environment jsdom */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tabs } from 'antd';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TabData } from '../types';
import {
  shouldBlockWorkbenchTabDetach,
  shouldDestroyHiddenWorkbenchTab,
} from './workbenchTabLifecycle';

const buildQueryTab = (id: string): TabData => ({
  id,
  title: id,
  type: 'query',
  connectionId: 'conn-1',
  dbName: 'main',
});

const buildTableTab = (id: string): TabData => ({
  id,
  title: id,
  type: 'table',
  connectionId: 'conn-1',
  dbName: 'main',
  tableName: 'users',
});

describe('workbench tab lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it('destroys hidden query tabs but keeps non-query and pending-transaction tabs mounted', () => {
    expect(shouldDestroyHiddenWorkbenchTab(buildQueryTab('query-1'), {})).toBe(true);
    expect(shouldDestroyHiddenWorkbenchTab(buildTableTab('table-1'), {})).toBe(false);
    expect(shouldDestroyHiddenWorkbenchTab(buildQueryTab('query-pending'), {
      'query-pending': { id: 'tx-1' },
    })).toBe(false);
    expect(shouldDestroyHiddenWorkbenchTab(buildQueryTab('query-dirty-result'), {}, true)).toBe(false);
  });

  it('blocks detaching query tabs while a result grid has pending edits', () => {
    expect(shouldBlockWorkbenchTabDetach(buildQueryTab('query-clean'), false)).toBe(false);
    expect(shouldBlockWorkbenchTabDetach(buildQueryTab('query-dirty'), true)).toBe(true);
    expect(shouldBlockWorkbenchTabDetach({ type: 'table' }, true)).toBe(false);
  });

  it('keeps one query probe and one listener set mounted after visiting twenty query tabs', async () => {
    const queryTabs = Array.from({ length: 20 }, (_, index) => buildQueryTab(`query-${index + 1}`));
    const mounted = new Set<string>();
    let activeGlobalListeners = 0;
    const globalEventNames = ['keydown', 'keyup', 'blur', 'dragend', 'drop'] as const;

    const Probe = ({ id }: { id: string }) => {
      useEffect(() => {
        const listener = () => undefined;
        mounted.add(id);
        globalEventNames.forEach((eventName) => window.addEventListener(eventName, listener));
        activeGlobalListeners += globalEventNames.length;
        return () => {
          mounted.delete(id);
          globalEventNames.forEach((eventName) => window.removeEventListener(eventName, listener));
          activeGlobalListeners -= globalEventNames.length;
        };
      }, [id]);
      return <div data-query-probe={id} />;
    };

    const renderActive = async (activeKey: string) => {
      await act(async () => {
        root.render(
          <Tabs
            activeKey={activeKey}
            animated={false}
            items={queryTabs.map((tab) => ({
              key: tab.id,
              label: tab.title,
              destroyOnHidden: shouldDestroyHiddenWorkbenchTab(tab, {}),
              children: <Probe id={tab.id} />,
            }))}
          />,
        );
      });
    };

    for (const tab of queryTabs) {
      await renderActive(tab.id);
      expect(mounted).toEqual(new Set([tab.id]));
      expect(activeGlobalListeners).toBe(globalEventNames.length);
    }
  });
});
