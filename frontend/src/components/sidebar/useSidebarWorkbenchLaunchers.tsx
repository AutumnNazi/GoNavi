import { useCallback, useMemo } from 'react';

import { t } from '../../i18n';
import type { SavedConnection, TabData } from '../../types';
import { getDataSourceCapabilities } from '../../utils/dataSourceCapabilities';
import { buildDMLSnapshotWorkbenchTab } from '../../utils/dmlSnapshotTab';
import { buildSqlAnalysisWorkbenchTab } from '../../utils/sqlAnalysisTab';
import { buildSqlAuditWorkbenchTab } from '../../utils/sqlAuditTab';
import { buildUserManagementWorkbenchTab } from '../../utils/userManagementTab';
import type { TitleBarQuickAction } from '../TitleBarQuickActions';
import { TitlebarUserManagementIcon } from '../titlebar/gonaviTitlebarIcons';

type UseSidebarWorkbenchLaunchersInput = {
  activeTab: TabData | null;
  activeTabHasConnection: boolean;
  activeConnection: SavedConnection | null;
  addTab: (tab: TabData) => void;
};

export type SidebarWorkbenchLaunchers = {
  openSlowQueryWorkbench: () => void;
  openSqlAuditWorkbench: () => void;
  openDMLSnapshotWorkbench: () => void;
  userManagementAction: TitleBarQuickAction;
};

/**
 * 标题栏「SQL 工具」「用户管理」等工作台入口的打开逻辑。
 * 从 Sidebar.tsx 拆出，Sidebar 只保留标题栏按钮数组的接线。
 */
export const useSidebarWorkbenchLaunchers = ({
  activeTab,
  activeTabHasConnection,
  activeConnection,
  addTab,
}: UseSidebarWorkbenchLaunchersInput): SidebarWorkbenchLaunchers => {
  const openSlowQueryWorkbench = useCallback(() => {
    if (!activeTabHasConnection || !activeTab?.connectionId) return;
    addTab(buildSqlAnalysisWorkbenchTab({
      connectionId: activeTab.connectionId,
      dbName: activeTab.dbName,
      view: 'slow-query',
    }));
  }, [activeTab?.connectionId, activeTab?.dbName, activeTabHasConnection, addTab]);

  const openSqlAuditWorkbench = useCallback(() => {
    addTab(buildSqlAuditWorkbenchTab());
  }, [addTab]);

  const openDMLSnapshotWorkbench = useCallback(() => {
    addTab(buildDMLSnapshotWorkbenchTab());
  }, [addTab]);

  // 当前连接支持时直接打开其用户管理；否则打开选择器标签，由工作台内选择连接。
  const openUserManagementWorkbench = useCallback(() => {
    const supported = activeConnection && getDataSourceCapabilities(activeConnection.config).supportsUserManagement;
    addTab(buildUserManagementWorkbenchTab(supported ? activeConnection.id : ''));
  }, [activeConnection, addTab]);

  const userManagementAction = useMemo<TitleBarQuickAction>(() => ({
    key: 'user-management',
    label: t('sidebar.action.user_management'),
    icon: <TitlebarUserManagementIcon size="100%" />,
    active: activeTab?.type === 'user-management',
    onClick: openUserManagementWorkbench,
  }), [activeTab?.type, openUserManagementWorkbench]);

  return {
    openSlowQueryWorkbench,
    openSqlAuditWorkbench,
    openDMLSnapshotWorkbench,
    userManagementAction,
  };
};
