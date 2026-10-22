/** @vitest-environment jsdom */
import React from 'react';
import { create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '../../store';
import SidebarFilterSlot from './SidebarFilterSlot';

// Navicat 布局会整排隐藏关系型对象筛选页签（与顶部工具栏重复），
// 但 Nacos 双分支页签与无连接时的行为要保持原样。这里只测槽位
// 的渲染分支；「残留过滤值复位」的规则在 sidebarExplorerFilter.test.ts。

const setLayoutMode = (mode: 'classic' | 'navicat') => {
  useStore.getState().setAppearance({ uiLayoutMode: mode });
};

const renderSlot = (props: Partial<React.ComponentProps<typeof SidebarFilterSlot>> = {}) => create(
  <SidebarFilterSlot
    activeConnection={{ config: { type: 'postgres' } } as any}
    treeData={[]}
    hasRelationalFilterConnection
    activeFilter="all"
    onFilterChange={vi.fn()}
    {...props}
  />,
);

const tabKeys = (json: any): string[] => (
  JSON.stringify(json).match(/data-object-kind-filter":"([a-z-]+)/g)?.map(m => m.split('":"')[1]) ?? []
);

afterEach(() => {
  setLayoutMode('classic');
});

describe('SidebarFilterSlot 布局差异', () => {
  it('classic 布局照常渲染关系型对象筛选页签', () => {
    setLayoutMode('classic');
    const keys = tabKeys(renderSlot().toJSON());
    expect(keys).toContain('all');
    expect(keys).toContain('tables');
  });

  it('navicat 布局隐藏关系型页签（与顶部工具栏重复）', () => {
    setLayoutMode('navicat');
    expect(renderSlot().toJSON()).toBeNull();
  });

  it('navicat 布局下无连接时的关系型预览页签也隐藏', () => {
    setLayoutMode('navicat');
    expect(renderSlot({ activeConnection: null }).toJSON()).toBeNull();
  });

  it('navicat 布局保留 Nacos 双分支页签', () => {
    setLayoutMode('navicat');
    const keys = tabKeys(renderSlot({ activeConnection: { config: { type: 'nacos' } } as any }).toJSON());
    expect(keys).toContain('nacos-services');
    expect(keys).toContain('nacos-configs');
    expect(keys).not.toContain('tables');
  });
});
