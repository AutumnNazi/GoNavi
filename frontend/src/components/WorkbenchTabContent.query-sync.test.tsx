import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import WorkbenchTabContent from './WorkbenchTabContent';

const storeHarness = vi.hoisted(() => ({ useStore: null as any }));
const queryEditorRenders = vi.hoisted(() => [] as string[]);

vi.mock('../store', async () => {
  const { create } = await import('zustand');
  storeHarness.useStore = create<{ tabs: TabData[] }>(() => ({ tabs: [] }));
  return { useStore: storeHarness.useStore };
});

vi.mock('antd', () => ({
  Spin: () => <span data-spin="true" />,
}));

vi.mock('./QueryEditor', () => ({
  default: ({ tab }: { tab: TabData }) => {
    queryEditorRenders.push(String(tab.query ?? ''));
    return <div data-query-editor-query={tab.query} />;
  },
}));

const createQueryTab = (query: string): TabData => ({
  id: 'query-live-sync',
  title: 'Query',
  type: 'query',
  connectionId: 'connection-1',
  dbName: 'database-1',
  query,
});

describe('WorkbenchTabContent query isolation', () => {
  it('keeps external and native query replacements live below the chrome boundary', async () => {
    queryEditorRenders.length = 0;
    const renderSnapshot = createQueryTab('select stale');
    storeHarness.useStore.setState({ tabs: [createQueryTab('select live')] });
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkbenchTabContent tab={renderSnapshot} isActive />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer!.root.findByProps({ 'data-query-editor-query': 'select live' })).toBeTruthy();

    act(() => {
      storeHarness.useStore.setState({ tabs: [createQueryTab('select native sync')] });
    });

    expect(renderer!.root.findByProps({ 'data-query-editor-query': 'select native sync' })).toBeTruthy();
    expect(queryEditorRenders).toEqual(['select live', 'select native sync']);
    act(() => renderer!.unmount());
  });
});
