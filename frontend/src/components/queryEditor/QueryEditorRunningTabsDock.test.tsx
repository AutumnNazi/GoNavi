import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import {
  buildQueryEditorRunningDockItems,
  QueryEditorRunningTabsDock,
  resolveQueryEditorRunningDockChipAppearance,
  shouldUseQueryEditorRunningDockMenu,
} from './QueryEditorRunningTabsDock';
import {
  getQueryEditorTabExecutionAppearance,
  resetQueryEditorTabExecutionStateForTests,
  setQueryEditorTabExecutionAppearance,
  setQueryEditorTabExecuting,
} from './queryEditorTabExecutionState';

const setActiveTab = vi.fn();

vi.mock('antd', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../store', () => ({
  useStore: (selector: (state: {
    tabs: Array<{ id: string; title: string }>;
    activeTabId: string;
    setActiveTab: (id: string) => void;
  }) => unknown) => selector({
    tabs: [
      { id: 'query-1', title: 'RFM 客户分析' },
      { id: 'query-2', title: '订单汇总' },
    ],
    activeTabId: 'table-1',
    setActiveTab,
  }),
}));

describe('buildQueryEditorRunningDockItems', () => {
  const tabs = [
    { id: 'query-1', title: 'RFM 客户分析' },
    { id: 'table-1', title: 'lab_customers' },
    { id: 'query-2', title: '订单汇总' },
  ];

  it('hides the active SQL tab so the chip appears after switching away', () => {
    expect(buildQueryEditorRunningDockItems(
      [{ tabId: 'query-1', appearance: 'running' }],
      'query-1',
      tabs,
    )).toEqual([]);
    expect(buildQueryEditorRunningDockItems(
      [{ tabId: 'query-1', appearance: 'done' }],
      'table-1',
      tabs,
    )).toEqual([
      { id: 'query-1', title: 'RFM 客户分析', appearance: 'done' },
    ]);
  });

  it('omits dock entries whose query tabs were already closed', () => {
    expect(buildQueryEditorRunningDockItems(
      [
        { tabId: 'query-gone', appearance: 'done' },
        { tabId: 'query-1', appearance: 'done' },
      ],
      'table-1',
      tabs,
    )).toEqual([
      { id: 'query-1', title: 'RFM 客户分析', appearance: 'done' },
    ]);
  });

  it('lists every background SQL run without duplicating ids', () => {
    expect(buildQueryEditorRunningDockItems(
      [
        { tabId: 'query-1', appearance: 'running' },
        { tabId: 'query-1', appearance: 'running' },
        { tabId: 'query-2', appearance: 'done' },
      ],
      'table-1',
      tabs,
    )).toEqual([
      { id: 'query-1', title: 'RFM 客户分析', appearance: 'running' },
      { id: 'query-2', title: '订单汇总', appearance: 'done' },
    ]);
    expect(shouldUseQueryEditorRunningDockMenu(1)).toBe(false);
    expect(shouldUseQueryEditorRunningDockMenu(2)).toBe(true);
    expect(resolveQueryEditorRunningDockChipAppearance([
      { appearance: 'done' },
      { appearance: 'running' },
    ])).toBe('running');
  });
});

describe('QueryEditorRunningTabsDock', () => {
  beforeEach(() => {
    setCurrentLanguage('zh-CN');
    resetQueryEditorTabExecutionStateForTests();
    setActiveTab.mockReset();
  });

  afterEach(() => {
    resetQueryEditorTabExecutionStateForTests();
  });

  it('shows a persistent chip after switching away from a running SQL tab', () => {
    const idle = create(<QueryEditorRunningTabsDock />);
    expect(JSON.stringify(idle.toJSON())).toBe('null');

    act(() => {
      setQueryEditorTabExecuting('query-1', true);
    });
    const running = create(<QueryEditorRunningTabsDock />);
    const tree = JSON.stringify(running.toJSON());
    expect(tree).toContain('query-editor-running-dock');
    expect(tree).toContain('运行中');
    expect(tree).toContain('RFM 客户分析');
    expect(tree).toContain('"data-status":"running"');
  });

  it('keeps a completed SQL chip until the user jumps back', () => {
    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'done');
    });
    const done = create(<QueryEditorRunningTabsDock />);
    const tree = JSON.stringify(done.toJSON());
    expect(tree).toContain('已完成');
    expect(tree).toContain('"data-status":"done"');

    act(() => {
      done.root.findByType('button').props.onClick();
    });
    expect(setActiveTab).toHaveBeenCalledWith('query-1');
    expect(getQueryEditorTabExecutionAppearance('query-1')).toBe('read');
  });

  it('collapses multiple background runs into one chip with a count', () => {
    act(() => {
      setQueryEditorTabExecuting('query-1', true);
      setQueryEditorTabExecuting('query-2', true);
    });
    const running = create(<QueryEditorRunningTabsDock />);
    const tree = JSON.stringify(running.toJSON());
    expect(tree).toContain('运行中 · 2');
    expect(tree).not.toContain('订单汇总');
  });

  it('forgets execution status for tabs that are no longer open', () => {
    act(() => {
      setQueryEditorTabExecutionAppearance('query-gone', 'done');
      setQueryEditorTabExecutionAppearance('query-1', 'done');
    });
    act(() => {
      create(<QueryEditorRunningTabsDock />);
    });
    expect(getQueryEditorTabExecutionAppearance('query-gone')).toBe('idle');
    expect(getQueryEditorTabExecutionAppearance('query-1')).toBe('done');
  });
});
