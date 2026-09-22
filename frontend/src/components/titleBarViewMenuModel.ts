export interface TitleBarViewMenuToggle {
  kind: 'toggle';
  key: string;
  label: string;
  shortcut?: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

export interface TitleBarViewMenuSeparator {
  kind: 'separator';
  key: string;
}

export type TitleBarViewMenuEntry = TitleBarViewMenuToggle | TitleBarViewMenuSeparator;

export const isTitleBarViewMenuToggle = (
  entry: TitleBarViewMenuEntry,
): entry is TitleBarViewMenuToggle => entry.kind === 'toggle';

export interface TitleBarViewMenuModelInput {
  aiPanelVisible: boolean;
  settingsOpen: boolean;
  sidebarCollapsed: boolean;
  sqlLogOpen: boolean;
  sqlLogAvailable: boolean;
  fullscreen: boolean;
  labels: {
    aiPanel: string;
    settingsCenter: string;
    sidebar: string;
    sqlLog: string;
    sqlLogNeedsQuery: string;
    fullscreen: string;
  };
  shortcuts: {
    aiPanel?: string;
    sqlLog?: string;
  };
  actions: {
    toggleAI: () => void;
    openSettings: () => void;
    closeSettings: () => void;
    expandSidebar: () => void;
    collapseSidebar: () => void;
    toggleSqlLog: () => void;
    toggleFullscreen: () => void;
  };
}

/** 视图菜单只放「再点一次就关掉」的面板，顺序与工作台从左到右、从上到下一致。 */
export function buildTitleBarViewMenuEntries(
  input: TitleBarViewMenuModelInput,
): TitleBarViewMenuEntry[] {
  const { actions, labels, shortcuts } = input;
  return [
    {
      kind: 'toggle',
      key: 'view-ai-panel',
      label: labels.aiPanel,
      shortcut: shortcuts.aiPanel,
      checked: input.aiPanelVisible,
      onClick: actions.toggleAI,
    },
    {
      kind: 'toggle',
      key: 'view-settings-center',
      label: labels.settingsCenter,
      checked: input.settingsOpen,
      onClick: () => {
        if (input.settingsOpen) {
          actions.closeSettings();
          return;
        }
        actions.openSettings();
      },
    },
    {
      kind: 'toggle',
      key: 'view-sidebar',
      label: labels.sidebar,
      checked: !input.sidebarCollapsed,
      onClick: () => {
        if (input.sidebarCollapsed) {
          actions.expandSidebar();
          return;
        }
        actions.collapseSidebar();
      },
    },
    {
      kind: 'toggle',
      key: 'view-sql-log',
      label: labels.sqlLog,
      shortcut: shortcuts.sqlLog,
      checked: input.sqlLogAvailable && input.sqlLogOpen,
      disabled: !input.sqlLogAvailable,
      title: input.sqlLogAvailable ? undefined : input.labels.sqlLogNeedsQuery,
      onClick: actions.toggleSqlLog,
    },
    { kind: 'separator', key: 'view-separator-window' },
    {
      kind: 'toggle',
      key: 'view-fullscreen',
      label: labels.fullscreen,
      checked: input.fullscreen,
      onClick: actions.toggleFullscreen,
    },
  ];
}
