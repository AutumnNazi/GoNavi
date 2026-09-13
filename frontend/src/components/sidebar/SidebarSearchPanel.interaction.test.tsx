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
    Tooltip: passthrough,
  };
});

vi.mock('@ant-design/icons', () => {
  const Icon = () => <span data-icon="true" />;
  return {
    CloseOutlined: Icon,
    CopyOutlined: Icon,
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

  it('renders only the command input without sidebar-filter sync controls', () => {
    vi.stubGlobal('document', { body: {} });

    const renderer = create(
      <SidebarSearchPanel
        isOpen
        searchValue="orders"
        activeIndex={0}
        label="Search"
        placeholder="Search"
        aiMode={false}
        objectMode={false}
        flatItems={[]}
        sections={{ goTo: [], ai: [], actions: [], recent: [] }}
        inputRef={{ current: null }}
        handlers={{
          onSearchValueChange: vi.fn(),
          onKeyDown: vi.fn(),
          onClose: vi.fn(),
          onItemSelect: vi.fn(),
          onItemHover: vi.fn(),
          onRemoveRecentItem: vi.fn(),
          onClearRecentItems: vi.fn(),
        }}
      />,
    );

    expect(renderer.root.findAllByType('input')).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: 'gn-v2-command-filter-switch' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'sidebar.command_search.reset_filter' })).toHaveLength(0);
  });

  it('opens a copy context menu without selecting the row and closes after copying', async () => {
    vi.stubGlobal('document', { body: {} });
    const onItemSelect = vi.fn();
    const onCopyCommandSearchItem = vi.fn();
    const getCopyOptions = vi.fn(() => [
      { action: 'object-name' as const, label: 'Copy object name' },
      { action: 'database-name' as const, label: 'Copy database name' },
    ]);
    const item = {
      key: 'node-table-1',
      kind: 'node' as const,
      title: 'orders',
      icon: <span />,
    };

    const renderer = create(
      <SidebarSearchPanel
        isOpen
        searchValue=""
        activeIndex={0}
        label="Search"
        placeholder="Search"
        aiMode={false}
        objectMode={false}
        flatItems={[item]}
        sections={{ goTo: [item], ai: [], actions: [], recent: [] }}
        inputRef={{ current: null }}
        handlers={{
          onSearchValueChange: vi.fn(),
          onKeyDown: vi.fn(),
          onClose: vi.fn(),
          onItemSelect,
          onItemHover: vi.fn(),
          onRemoveRecentItem: vi.fn(),
          onClearRecentItems: vi.fn(),
          getCopyOptions,
          onCopyCommandSearchItem,
        }}
      />,
    );

    const row = renderer.root.findByProps({ className: 'gn-v2-command-row-shell is-active' });
    const contextEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 100,
      clientY: 120,
    };
    await act(async () => row.props.onContextMenu(contextEvent));

    expect(contextEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(contextEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(getCopyOptions).toHaveBeenCalledWith(item);
    expect(onItemSelect).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-v2-command-context-menu': 'true' })).toBeTruthy();

    const copyButtons = renderer.root.findAllByProps({ className: 'gn-v2-command-context-menu-item' });
    expect(copyButtons).toHaveLength(2);
    await act(async () => {
      copyButtons[0].props.onClick({ stopPropagation: vi.fn() });
    });

    expect(onCopyCommandSearchItem).toHaveBeenCalledWith(item, 'object-name');
    expect(renderer.root.findAllByProps({ 'data-v2-command-context-menu': 'true' })).toHaveLength(0);
  });

  it('blocks the browser menu for action results without showing copy actions', async () => {
    vi.stubGlobal('document', { body: {} });
    const item = {
      key: 'action-new-query',
      kind: 'action' as const,
      title: 'New query',
      icon: <span />,
    };

    const renderer = create(
      <SidebarSearchPanel
        isOpen
        searchValue=""
        activeIndex={0}
        label="Search"
        placeholder="Search"
        aiMode={false}
        objectMode={false}
        flatItems={[item]}
        sections={{ goTo: [], ai: [], actions: [item], recent: [] }}
        inputRef={{ current: null }}
        handlers={{
          onSearchValueChange: vi.fn(),
          onKeyDown: vi.fn(),
          onClose: vi.fn(),
          onItemSelect: vi.fn(),
          onItemHover: vi.fn(),
          onRemoveRecentItem: vi.fn(),
          onClearRecentItems: vi.fn(),
          getCopyOptions: vi.fn(() => [{ action: 'sql' as const, label: 'Copy SQL' }]),
          onCopyCommandSearchItem: vi.fn(),
        }}
      />,
    );

    const row = renderer.root.findByProps({ className: 'gn-v2-command-row-shell is-active' });
    const contextEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 0, clientY: 0 };
    await act(async () => row.props.onContextMenu(contextEvent));

    expect(contextEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ 'data-v2-command-context-menu': 'true' })).toHaveLength(0);
  });

});
