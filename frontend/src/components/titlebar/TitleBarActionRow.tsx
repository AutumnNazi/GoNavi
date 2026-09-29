import React from 'react';

import { useI18n } from '../../i18n/provider';
import type { TitlebarActionsPlacement } from '../../utils/titlebarActionsPlacement';
import TitleBarPrimaryActions from '../TitleBarPrimaryActions';
import TitleBarToolBar from './TitleBarToolBar';
import TitleBarToolBarAiAction from './TitleBarToolBarAiAction';

import './titleBarActionRow.css';

/** Sidebar 通过 portal 注入「数据工作流 / SQL 工具 / 用户管理」的插槽 id。 */
export const TITLEBAR_QUICK_ACTIONS_SLOT_ID = 'gonavi-titlebar-quick-actions';

export interface TitleBarActionRowProps {
  placement: TitlebarActionsPlacement;
  /** 当前主操作是消息队列工作台时，「新建查询」换成「打开消息队列」。 */
  messageQueuePrimary: boolean;
  newQueryShortcut?: string;
  newConnectionShortcut?: string;
  onNewQuery: () => void;
  onNewConnection: () => void;
  onManageConnectionGroups: () => void;
  aiActive: boolean;
  onToggleAI: () => void;
  /** 跟在 AI 之后的槽位（macOS 的驱动管理 / 关于），非 macOS 不传。 */
  trailingSlot?: React.ReactNode;
}

/**
 * 「新建连接 / 新建查询 / 管理连接分组 / 快捷入口 / AI」这一行。
 *
 * - toolbar：包进标题栏下方的独立工具条，图标 + 文字。
 * - titlebar：内联到标题栏 GoNavi 右侧。容器用 display: contents，
 *   子元素直接参与 .gonavi-titlebar-leading 的弹性布局，
 *   App.css 里改版前的标题栏样式原样生效，图标由作用域样式隐藏。
 */
export default function TitleBarActionRow({
  placement,
  messageQueuePrimary,
  newQueryShortcut,
  newConnectionShortcut,
  onNewQuery,
  onNewConnection,
  onManageConnectionGroups,
  aiActive,
  onToggleAI,
  trailingSlot,
}: TitleBarActionRowProps) {
  const { t } = useI18n();
  const actions = (
    <>
      <TitleBarPrimaryActions
        newQueryLabel={t(messageQueuePrimary ? 'message_queue_workbench.action.open' : 'query.new')}
        newConnectionLabel={t('connection.new')}
        newQueryShortcut={newQueryShortcut}
        newConnectionShortcut={newConnectionShortcut}
        onNewQuery={onNewQuery}
        onNewConnection={onNewConnection}
        connectionGroupLabel={t('connection.sidebar.management.title')}
        onConnectionGroupManagement={onManageConnectionGroups}
      />
      <div id={TITLEBAR_QUICK_ACTIONS_SLOT_ID} className="gonavi-titlebar-quick-actions-slot" />
      <TitleBarToolBarAiAction
        label={t('app.titlebar.toolbar.ai')}
        title={t('app.sidebar.ai_assistant')}
        active={aiActive}
        onClick={onToggleAI}
      />
      {trailingSlot}
    </>
  );

  if (placement === 'titlebar') {
    return (
      <div
        className="gonavi-titlebar-inline-actions"
        data-titlebar-actions-placement="titlebar"
        role="group"
        aria-label={t('app.titlebar.toolbar.aria')}
      >
        {actions}
      </div>
    );
  }
  return <TitleBarToolBar ariaLabel={t('app.titlebar.toolbar.aria')}>{actions}</TitleBarToolBar>;
}
