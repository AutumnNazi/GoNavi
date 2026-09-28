import React from 'react';
import {
  getShortcutDisplayLabel,
  resolveShortcutBinding,
  type ShortcutOptions,
  type ShortcutPlatform,
} from '../utils/shortcuts';
import { TitlebarDatabaseIcon, TitlebarGridIcon, TitlebarPlugIcon } from './titlebar/gonaviTitlebarIcons';

type TitleBarPrimaryShortcutAction = 'newQueryTab' | 'newConnection';

export const resolveTitleBarPrimaryActionShortcut = (
  shortcutOptions: Partial<ShortcutOptions> | null | undefined,
  action: TitleBarPrimaryShortcutAction,
  platform: ShortcutPlatform,
): string | undefined => {
  const binding = resolveShortcutBinding(shortcutOptions, action, platform);
  return binding.enabled && binding.combo
    ? getShortcutDisplayLabel(binding.combo, platform)
    : undefined;
};

interface TitleBarPrimaryActionsProps {
  newQueryLabel: string;
  newConnectionLabel: string;
  newQueryShortcut?: string;
  newConnectionShortcut?: string;
  onNewQuery: () => void;
  onNewConnection: () => void;
  connectionGroupLabel?: string;
  onConnectionGroupManagement?: () => void;
}

const getActionTitle = (label: string, shortcut?: string): string => (
  shortcut ? `${label} · ${shortcut}` : label
);

/**
 * 工具条按钮的图标+文字内容。
 *
 * 图标挂在 `data-titlebar-toolbar-icon` 而不是通用的 `data-titlebar-icon`
 * 上：后者是「快捷入口图标」的既有标记，语义不同，混用会让两侧的断言
 * 互相干扰。
 */
const renderToolbarActionContent = (
  label: string,
  icon: React.ReactNode,
): React.ReactNode => (
  <>
    <span className="gn-titlebar-toolbar-item-icon" data-titlebar-toolbar-icon="true" aria-hidden="true">
      {icon}
    </span>
    <span className="gn-titlebar-toolbar-item-label">{label}</span>
  </>
);

const TitleBarPrimaryActions: React.FC<TitleBarPrimaryActionsProps> = ({
  newQueryLabel,
  newConnectionLabel,
  newQueryShortcut,
  newConnectionShortcut,
  onNewQuery,
  onNewConnection,
  connectionGroupLabel,
  onConnectionGroupManagement,
}) => (
  <div
    className="gonavi-titlebar-primary-actions"
    data-titlebar-primary-actions="true"
    data-no-titlebar-toggle="true"
    onDoubleClick={(event) => event.stopPropagation()}
  >
    {/* 顺序对齐参考稿：新建连接在前，新建查询在后。 */}
    <button
      type="button"
      className="gonavi-titlebar-primary-action"
      aria-label={newConnectionLabel}
      title={getActionTitle(newConnectionLabel, newConnectionShortcut)}
      data-gonavi-create-connection-action="true"
      onClick={onNewConnection}
    >
      {renderToolbarActionContent(newConnectionLabel, <TitlebarPlugIcon size="100%" />)}
    </button>
    <button
      type="button"
      className="gonavi-titlebar-primary-action"
      aria-label={newQueryLabel}
      title={getActionTitle(newQueryLabel, newQueryShortcut)}
      data-gonavi-new-query-action="true"
      onClick={onNewQuery}
    >
      {renderToolbarActionContent(newQueryLabel, <TitlebarGridIcon size="100%" />)}
    </button>
    {connectionGroupLabel && onConnectionGroupManagement && <button type="button" className="gonavi-titlebar-primary-action" aria-label={connectionGroupLabel} data-gonavi-connection-group-management-action="true" onClick={onConnectionGroupManagement}>
      {renderToolbarActionContent(connectionGroupLabel, <TitlebarDatabaseIcon size="100%" />)}
    </button>}
  </div>
);

export default TitleBarPrimaryActions;
