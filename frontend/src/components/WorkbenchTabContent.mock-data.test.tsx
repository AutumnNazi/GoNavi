import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import WorkbenchTabContent from './WorkbenchTabContent';

vi.mock('antd', () => ({
  Spin: () => <span data-spin="true" />,
}));

vi.mock('./mockData/MockDataWorkbench', () => ({
  default: ({ tab }: { tab: TabData }) => (
    <div data-routed-mock-data-workbench="true" data-tab-id={tab.id} data-table-name={tab.tableName} />
  ),
}));

describe('WorkbenchTabContent mock data routing', () => {
  it('renders mock-data tabs through the mock data workbench', async () => {
    const tab: TabData = {
      id: 'mock-data:conn-1:app:users',
      title: '模拟数据 · users',
      type: 'mock-data',
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'users',
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<WorkbenchTabContent tab={tab} isActive />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const workbench = renderer!.root.findByProps({ 'data-routed-mock-data-workbench': 'true' });
    expect(workbench.props['data-tab-id']).toBe(tab.id);
    expect(workbench.props['data-table-name']).toBe('users');
  });
});
