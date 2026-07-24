import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import WorkbenchTabContent from './WorkbenchTabContent';

vi.mock('antd', () => ({
  Spin: () => <span data-spin="true" />,
}));

vi.mock('./DataSyncWorkbench', () => ({
  default: ({ tab }: { tab: TabData }) => (
    <div
      data-routed-data-sync-workbench="true"
      data-tab-id={tab.id}
      data-entry-mode={tab.dataSyncEntryMode}
    />
  ),
}));

describe('WorkbenchTabContent data sync routing', () => {
  it('renders data-sync tabs through the data sync workbench', async () => {
    const tab: TabData = {
      id: 'data-sync-workbench-data-compare',
      title: '数据比对',
      type: 'data-sync',
      connectionId: '',
      dataSyncEntryMode: 'dataCompare',
    };
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkbenchTabContent tab={tab} isActive />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const workbench = renderer!.root.findByProps({
      'data-routed-data-sync-workbench': 'true',
    });
    expect(workbench.props['data-tab-id']).toBe(tab.id);
    expect(workbench.props['data-entry-mode']).toBe('dataCompare');
  });
});
