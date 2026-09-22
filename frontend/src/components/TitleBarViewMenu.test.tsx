import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import TitleBarViewMenu from './TitleBarViewMenu';
import {
  isTitleBarViewMenuToggle,
  type TitleBarViewMenuEntry,
} from './titleBarViewMenuModel';

vi.mock('antd', () => ({
  Dropdown: ({
    children,
    popupRender,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    popupRender?: (menu: React.ReactNode) => React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-dropdown-open={open ? 'true' : 'false'} onClick={() => onOpenChange?.(!open)}>
      {children}
      {open ? popupRender?.(null) : null}
    </div>
  ),
}));

const buildEntries = (): { entries: TitleBarViewMenuEntry[]; handlers: Record<string, ReturnType<typeof vi.fn>> } => {
  const handlers = {
    onAIPanel: vi.fn(),
    onSettingsCenter: vi.fn(),
    onSidebar: vi.fn(),
    onSqlLog: vi.fn(),
    onFullscreen: vi.fn(),
  };
  const entries: TitleBarViewMenuEntry[] = [
    { kind: 'toggle', key: 'view-ai-panel', label: 'AI Assistant', shortcut: '⌘J', checked: true, onClick: handlers.onAIPanel },
    { kind: 'toggle', key: 'view-settings-center', label: 'Settings Center', checked: false, onClick: handlers.onSettingsCenter },
    { kind: 'toggle', key: 'view-sidebar', label: 'Connection Explorer', checked: true, onClick: handlers.onSidebar },
    { kind: 'toggle', key: 'view-sql-log', label: 'SQL Log', shortcut: '⌃H', checked: false, disabled: true, title: 'Open a query tab first', onClick: handlers.onSqlLog },
    { kind: 'separator', key: 'view-separator-window' },
    { kind: 'toggle', key: 'view-fullscreen', label: 'Full Screen', checked: false, onClick: handlers.onFullscreen },
  ];
  return { entries, handlers };
};

const openMenu = async (renderer: ReturnType<typeof create>) => {
  const dropdown = renderer.root.findByProps({ 'data-dropdown-open': 'false' }) as ReactTestInstance;
  await act(async () => { dropdown.props.onClick(); });
};

describe('TitleBarViewMenu', () => {
  it('renders a titlebar word that opts out of drag and double-click maximise', () => {
    const { entries } = buildEntries();
    const renderer = create(<TitleBarViewMenu label="View" entries={entries} />);
    const trigger = renderer.root.findByProps({ 'data-titlebar-view-menu': 'true' });

    expect(trigger.type).toBe('button');
    expect(trigger.props.className).toContain('gn-view-menu-trigger');
    expect(trigger.props['data-no-titlebar-toggle']).toBe('true');
    expect(trigger.props['aria-label']).toBe('View');
    expect(trigger.props['aria-haspopup']).toBe('menu');
    expect(trigger.children).toContain('View');
  });

  it('shows a left check only on checked items, and the shortcut on the right', async () => {
    const { entries } = buildEntries();
    const renderer = create(<TitleBarViewMenu label="View" entries={entries} />);
    await openMenu(renderer);

    const checked = renderer.root.findAllByProps({ role: 'menuitemcheckbox' })
      .filter((item) => item.props['aria-checked'] === true)
      .map((item) => item.props['data-view-menu-key']);
    expect(checked).toEqual(['view-ai-panel', 'view-sidebar']);

    const ai = renderer.root.findByProps({ 'data-view-menu-key': 'view-ai-panel' });
    expect(ai.findAllByType('svg')).toHaveLength(1);
    expect(ai.findByProps({ className: 'gn-view-menu-shortcut' }).children).toContain('⌘J');

    const settings = renderer.root.findByProps({ 'data-view-menu-key': 'view-settings-center' });
    expect(settings.findAllByType('svg')).toHaveLength(0);
  });

  it('keeps panel toggles, a divider, then fullscreen', async () => {
    const { entries } = buildEntries();
    const renderer = create(<TitleBarViewMenu label="View" entries={entries} />);
    await openMenu(renderer);

    const keys = renderer.root.findAll(
      (node) => typeof node.props['data-view-menu-key'] === 'string' || node.props.role === 'separator',
    ).map((node) => node.props['data-view-menu-key'] ?? 'separator');
    expect(keys).toEqual([
      'view-ai-panel',
      'view-settings-center',
      'view-sidebar',
      'view-sql-log',
      'separator',
      'view-fullscreen',
    ]);
  });

  it('dispatches a toggle once and closes the menu', async () => {
    const { entries, handlers } = buildEntries();
    const renderer = create(<TitleBarViewMenu label="View" entries={entries} />);
    await openMenu(renderer);

    const ai = renderer.root.findByProps({ 'data-view-menu-key': 'view-ai-panel' });
    await act(async () => { ai.props.onClick(); });

    expect(handlers.onAIPanel).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ 'data-titlebar-view-menu-panel': 'true' })).toHaveLength(0);
  });

  it('keeps a disabled SQL log item visible but non-interactive', async () => {
    const { entries, handlers } = buildEntries();
    const renderer = create(<TitleBarViewMenu label="View" entries={entries} />);
    await openMenu(renderer);

    const sqlLog = renderer.root.findByProps({ 'data-view-menu-key': 'view-sql-log' });
    expect(sqlLog.props['aria-disabled']).toBe(true);
    expect(sqlLog.props.title).toBe('Open a query tab first');
    await act(async () => { sqlLog.props.onClick(); });
    expect(handlers.onSqlLog).not.toHaveBeenCalled();
    expect(isTitleBarViewMenuToggle(entries[3])).toBe(true);
  });
});
