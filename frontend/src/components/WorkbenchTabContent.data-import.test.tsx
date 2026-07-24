import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import WorkbenchTabContent from './WorkbenchTabContent';

vi.mock('antd', () => ({
  Spin: () => <span data-spin="true" />,
}));

vi.mock('./DataImportWorkbench', () => ({
  default: ({ tab }: { tab: TabData }) => (
    <div
      data-routed-data-import-workbench="true"
      data-tab-id={tab.id}
      data-table-name={tab.tableName}
    />
  ),
}));

describe('WorkbenchTabContent data import routing', () => {
  it('renders data-import tabs through the data import workbench', async () => {
    const tab: TabData = {
      id: 'data-import-workbench',
      title: '数据导入',
      type: 'data-import',
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'users',
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
      'data-routed-data-import-workbench': 'true',
    });
    expect(workbench.props['data-tab-id']).toBe(tab.id);
    expect(workbench.props['data-table-name']).toBe('users');
  });
});
