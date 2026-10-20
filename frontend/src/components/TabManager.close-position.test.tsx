// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 替身 Tabs：只渲染 items 的 label，避免把 Monaco 工作台面板拉进单测。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const StubTabs = ({ items }: { items?: Array<{ key: string; label?: React.ReactNode }> }) => (
    <div data-testid="stub-tabs">
      {items?.map((item) => <div key={item.key}>{item.label}</div>)}
    </div>
  );
  return { ...actual, Tabs: StubTabs };
});

import TabManager from './TabManager';
import { useStore } from '../store';

const TAB_ID = 'tab-close-position';
const originalState = {
  tabs: useStore.getState().tabs,
  activeTabId: useStore.getState().activeTabId,
  appearance: useStore.getState().appearance,
};

const readTabLabel = () => {
  const label = document.querySelector<HTMLElement>('.tab-dnd-label');
  if (!label) throw new Error('tab label was not rendered');
  return label;
};

describe('TabManager close button position wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    useStore.setState({
      tabs: [{ id: TAB_ID, title: 'users', type: 'table', connectionId: 'conn-1' }],
      activeTabId: TAB_ID,
    });
    useStore.getState().setAppearance({ tabCloseButtonPosition: 'left' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<TabManager />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  it('renders the label close button from the tab manager items memo', () => {
    const label = readTabLabel();

    expect(label.getAttribute('data-tab-close-position')).toBe('left');
    expect(label.firstElementChild?.className).toBe('gn-v2-tab-close');
  });

  it('re-renders the label close button when the setting changes', async () => {
    await act(async () => {
      useStore.getState().setAppearance({ tabCloseButtonPosition: 'right' });
    });

    const label = readTabLabel();
    expect(label.getAttribute('data-tab-close-position')).toBe('right');
    expect(label.lastElementChild?.className).toBe('gn-v2-tab-close');
  });
});
