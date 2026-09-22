import { describe, expect, it, vi } from 'vitest';

import {
  buildTitleBarViewMenuEntries,
  type TitleBarViewMenuEntry,
  type TitleBarViewMenuToggle,
} from './titleBarViewMenuModel';

const toggleEntry = (entries: TitleBarViewMenuEntry[], key: string) => {
  const entry = entries.find((item) => item.kind === 'toggle' && item.key === key);
  if (!entry || entry.kind !== 'toggle') {
    throw new Error(`missing ${key}`);
  }
  return entry;
};

const buildInput = (overrides: Partial<Parameters<typeof buildTitleBarViewMenuEntries>[0]> = {}) => {
  const actions = {
    toggleAI: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    expandSidebar: vi.fn(),
    collapseSidebar: vi.fn(),
    toggleSqlLog: vi.fn(),
    toggleFullscreen: vi.fn(),
  };
  const entries = buildTitleBarViewMenuEntries({
    aiPanelVisible: false,
    settingsOpen: false,
    sidebarCollapsed: false,
    sqlLogOpen: true,
    sqlLogAvailable: true,
    fullscreen: false,
    labels: {
      aiPanel: 'AI',
      settingsCenter: 'Settings',
      sidebar: 'Explorer',
      sqlLog: 'SQL Log',
      sqlLogNeedsQuery: 'Open a query tab first',
      fullscreen: 'Full Screen',
    },
    shortcuts: { aiPanel: '⌘J', sqlLog: '⌃H' },
    actions,
    ...overrides,
  });
  return { actions, entries };
};

describe('buildTitleBarViewMenuEntries', () => {
  it('checks the surfaces that are actually visible', () => {
    const { entries } = buildInput({
      aiPanelVisible: true,
      settingsOpen: true,
      sidebarCollapsed: true,
      sqlLogOpen: true,
      fullscreen: true,
    });
    const checked = Object.fromEntries(
      entries
        .filter((entry): entry is TitleBarViewMenuToggle => entry.kind === 'toggle')
        .map((entry) => [entry.key, entry.checked]),
    );

    expect(checked).toEqual({
      'view-ai-panel': true,
      'view-settings-center': true,
      'view-sidebar': false,
      'view-sql-log': true,
      'view-fullscreen': true,
    });
  });

  it('closes settings when the settings row is already checked', () => {
    const { actions, entries } = buildInput({ settingsOpen: true });
    const settings = toggleEntry(entries, 'view-settings-center');
    settings.onClick();
    expect(actions.closeSettings).toHaveBeenCalledTimes(1);
    expect(actions.openSettings).not.toHaveBeenCalled();
  });

  it('opens settings when the settings row is unchecked', () => {
    const { actions, entries } = buildInput({ settingsOpen: false });
    const settings = toggleEntry(entries, 'view-settings-center');
    settings.onClick();
    expect(actions.openSettings).toHaveBeenCalledTimes(1);
  });

  it('hides the SQL log check outside a query tab', () => {
    const { entries } = buildInput({ sqlLogAvailable: false, sqlLogOpen: true });
    const sqlLog = toggleEntry(entries, 'view-sql-log');
    expect(sqlLog.disabled).toBe(true);
    expect(sqlLog.checked).toBe(false);
  });
});
