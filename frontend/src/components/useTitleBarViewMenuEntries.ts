import { useCallback, useMemo } from 'react';
import {
  WindowFullscreen,
  WindowIsFullscreen,
  WindowIsMaximised,
  WindowUnfullscreen,
} from '../../wailsjs/runtime';

import { useI18n } from '../i18n/provider';
import { useStore } from '../store';
import {
  getShortcutDisplayLabel,
  getShortcutPlatform,
  resolveShortcutBinding,
} from '../utils/shortcuts';
import { toggleWindowFullscreen } from '../utils/windowFullscreenToggle';
import {
  buildTitleBarViewMenuEntries,
  type TitleBarViewMenuEntry,
} from './titleBarViewMenuModel';

export interface TitleBarViewMenuController {
  isMacRuntime: boolean;
  activeTabType?: string;
  aiPanelVisible: boolean;
  fullscreen: boolean;
  settingsOpen: boolean;
  sidebarCollapsed: boolean;
  onToggleAI: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onExpandSidebar: () => void;
  onCollapseSidebar: () => void;
}

const shortcutLabel = (
  shortcutOptions: Parameters<typeof resolveShortcutBinding>[0],
  isMacRuntime: boolean,
  action: 'toggleAIPanel' | 'toggleLogPanel',
): string | undefined => {
  const platform = getShortcutPlatform(isMacRuntime);
  const binding = resolveShortcutBinding(shortcutOptions, action, platform);
  return binding.enabled && binding.combo
    ? getShortcutDisplayLabel(binding.combo, platform)
    : undefined;
};

/** 标题栏「视图」菜单的勾选态和动作。App 只传入已经存在的面板回调。 */
export function useTitleBarViewMenuEntries(
  input: TitleBarViewMenuController,
): TitleBarViewMenuEntry[] {
  const { t } = useI18n();
  const shortcutOptions = useStore((state) => state.shortcutOptions);
  const {
    activeTabType,
    aiPanelVisible,
    fullscreen,
    isMacRuntime,
    onCloseSettings,
    onCollapseSidebar,
    onExpandSidebar,
    onOpenSettings,
    onToggleAI,
    settingsOpen,
    sidebarCollapsed,
  } = input;
  const toggleFullscreen = useCallback(() => {
    void toggleWindowFullscreen({
      isFullscreen: () => WindowIsFullscreen(),
      isMaximised: () => WindowIsMaximised(),
      enterFullscreen: () => WindowFullscreen(),
      exitFullscreen: () => WindowUnfullscreen(),
      setWindowState: (state) => useStore.getState().setWindowState(state),
    });
  }, []);

  return useMemo(() => buildTitleBarViewMenuEntries({
    actions: {
      closeSettings: onCloseSettings,
      collapseSidebar: onCollapseSidebar,
      expandSidebar: onExpandSidebar,
      openSettings: onOpenSettings,
      toggleAI: onToggleAI,
      toggleFullscreen,
      toggleSqlLog: () => {
        // 先让菜单在这一帧收起，下一拍再打开结果区，避免点击被整页重绘卡住。
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('gonavi:show-sql-execution-log'));
        }, 0);
      },
    },
    aiPanelVisible,
    fullscreen,
    labels: {
      aiPanel: t('app.view_menu.ai_panel'),
      fullscreen: t('app.view_menu.fullscreen'),
      settingsCenter: t('app.view_menu.settings_center'),
      sidebar: t('app.view_menu.sidebar'),
      sqlLog: t('app.view_menu.sql_log'),
      sqlLogNeedsQuery: t('app.view_menu.sql_log_needs_query'),
    },
    settingsOpen,
    shortcuts: {
      aiPanel: shortcutLabel(shortcutOptions, isMacRuntime, 'toggleAIPanel'),
      sqlLog: shortcutLabel(shortcutOptions, isMacRuntime, 'toggleLogPanel'),
    },
    sidebarCollapsed,
    sqlLogAvailable: activeTabType === 'query',
    sqlLogOpen: false,
  }), [
    activeTabType,
    aiPanelVisible,
    fullscreen,
    isMacRuntime,
    onCloseSettings,
    onCollapseSidebar,
    onExpandSidebar,
    onOpenSettings,
    onToggleAI,
    settingsOpen,
    shortcutOptions,
    sidebarCollapsed,
    t,
    toggleFullscreen,
  ]);
}
