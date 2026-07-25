import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SidebarSearchPanel from './SidebarSearchPanel';

vi.mock('react-dom', () => ({
  createPortal: (children: React.ReactNode) => children,
}));

vi.mock('antd', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  );
  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
    ConfigProvider: passthrough,
    Input,
    Switch: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
    Tooltip: passthrough,
  };
});

vi.mock('@ant-design/icons', () => {
  const Icon = () => <span data-icon="true" />;
  return {
    CloseOutlined: Icon,
    ReloadOutlined: Icon,
    RobotOutlined: Icon,
    SearchOutlined: Icon,
    TableOutlined: Icon,
  };
});

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

const recentItem = {
  key: 'recent-log-1',
  kind: 'recent' as const,
  title: 'SELECT 1',
  meta: '10:30 · 12ms',
  icon: <span />,
};

describe('SidebarSearchPanel recent query actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes one recent query without selecting its row and clears the section independently', async () => {
    vi.stubGlobal('document', { body: {} });
    const onItemSelect = vi.fn();
    const onRemoveRecentItem = vi.fn();
    const onClearRecentItems = vi.fn();

    const renderer = create(
      <SidebarSearchPanel
        isOpen
        searchValue=""
        activeIndex={0}
        label="Search"
        placeholder="Search"
        persistedFilter=""
        persistentFilterEnabled={false}
        aiMode={false}
        objectMode={false}
        flatItems={[recentItem]}
        sections={{ goTo: [], ai: [], actions: [], recent: [recentItem] }}
        inputRef={{ current: null }}
        handlers={{
          onSearchValueChange: vi.fn(),
          onKeyDown: vi.fn(),
          onClose: vi.fn(),
          onItemSelect,
          onItemHover: vi.fn(),
          onTogglePersistentFilter: vi.fn(),
          onResetFilter: vi.fn(),
          onRemoveRecentItem,
          onClearRecentItems,
        }}
      />,
    );

    const removeButton = renderer.root.findByProps({ className: 'gn-v2-command-row-remove' });
    const removeMouseDown = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => {
      removeButton.props.onMouseDown(removeMouseDown);
      removeButton.props.onClick({ stopPropagation: vi.fn() });
    });

    expect(removeMouseDown.preventDefault).toHaveBeenCalledTimes(1);
    expect(removeMouseDown.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onRemoveRecentItem).toHaveBeenCalledWith(recentItem);
    expect(onItemSelect).not.toHaveBeenCalled();

    const clearButton = renderer.root.findByProps({ className: 'gn-v2-command-section-clear' });
    const clearMouseDown = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => {
      clearButton.props.onMouseDown(clearMouseDown);
      clearButton.props.onClick({ stopPropagation: vi.fn() });
    });

    expect(clearMouseDown.preventDefault).toHaveBeenCalledTimes(1);
    expect(clearMouseDown.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClearRecentItems).toHaveBeenCalledTimes(1);
  });
});
