/** @vitest-environment jsdom */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tabs } from 'antd';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveMountedQueryResultKey,
  shouldDestroyHiddenQueryResult,
} from './queryEditorResultLifecycle';

describe('query editor result pane lifecycle', () => {
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

  it('destroys clean hidden results but retains a grid with pending edits', () => {
    expect(shouldDestroyHiddenQueryResult({})).toBe(true);
    expect(shouldDestroyHiddenQueryResult({ hasPendingChanges: true })).toBe(false);
    expect(resolveMountedQueryResultKey([
      { key: 'result-clean' },
      { key: 'result-dirty', hasPendingChanges: true },
    ], 'result-clean', true)).toBe('result-dirty');
    expect(resolveMountedQueryResultKey([
      { key: 'result-clean' },
      { key: 'result-dirty', hasPendingChanges: true },
    ], 'result-clean', false)).toBe('result-clean');
  });

  it('keeps one DataGrid listener bundle mounted after visiting ten result tabs', async () => {
    const results = Array.from({ length: 10 }, (_, index) => ({ key: `result-${index + 1}` }));
    const mounted = new Set<string>();
    const eventNames = ['keydown', 'resize', 'scroll'] as const;
    let activeListeners = 0;

    const Probe = ({ resultKey }: { resultKey: string }) => {
      useEffect(() => {
        const listener = () => undefined;
        mounted.add(resultKey);
        eventNames.forEach((eventName) => window.addEventListener(eventName, listener));
        activeListeners += eventNames.length;
        return () => {
          mounted.delete(resultKey);
          eventNames.forEach((eventName) => window.removeEventListener(eventName, listener));
          activeListeners -= eventNames.length;
        };
      }, [resultKey]);
      return <div data-result-grid={resultKey} />;
    };

    const renderActive = async (activeKey: string) => {
      await act(async () => {
        root.render(
          <Tabs
            activeKey={activeKey}
            animated={false}
            items={results.map((result) => ({
              key: result.key,
              label: result.key,
              destroyOnHidden: shouldDestroyHiddenQueryResult(result),
              children: <Probe resultKey={result.key} />,
            }))}
          />,
        );
      });
    };

    for (const result of results) {
      await renderActive(result.key);
      expect(mounted).toEqual(new Set([result.key]));
      expect(activeListeners).toBe(eventNames.length);
    }
  });
});
