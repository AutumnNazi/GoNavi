import React from 'react';
import { ApartmentOutlined, CloudServerOutlined, ProfileOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { t } from '../../i18n';
import type { WorkbenchTabType } from '../../tabTypes';
import type { XxlJobPanel } from '../../typeDefs/workbenchTypes';
import type { SavedConnection } from '../../types';
import type { SidebarNodeMenuContext } from './sidebarNodeMenuHelpers';

const PANELS: Array<{ panel: XxlJobPanel; titleKey: string; icon: React.ReactNode }> = [
  { panel: 'groups', titleKey: 'xxljob.menu.executors', icon: <CloudServerOutlined /> },
  { panel: 'jobs', titleKey: 'xxljob.menu.jobs', icon: <ApartmentOutlined /> },
  { panel: 'logs', titleKey: 'xxljob.menu.logs', icon: <ProfileOutlined /> },
];

/**
 * XXL-JOB 连接节点的右键菜单：直接打开三种工作台面板，并保留连接级操作。
 * 这类连接的节点树是静态的，没有需要刷新的子资源，所以不提供刷新条目。
 */
export const buildXxlJobConnectionMenuItems = (
  conn: SavedConnection,
  node: unknown,
  context: SidebarNodeMenuContext,
): MenuProps['items'] => {
  const { addTab } = context;
  const openPanel = (panel: XxlJobPanel) => () => {
    addTab({
      id: `xxljob-${panel}-${conn.id}`,
      title: t(`xxljob.tab.${panel}`),
      type: `xxljob-${panel}` as WorkbenchTabType,
      connectionId: conn.id,
      xxlJobPanel: panel,
    });
  };

  return [
    ...PANELS.map(({ panel, titleKey, icon }) => ({
      key: `open-${panel}`,
      label: t(titleKey),
      icon,
      onClick: openPanel(panel),
    })),
    { type: 'divider' as const },
    {
      key: 'edit',
      label: t('sidebar.menu.edit_connection'),
      onClick: () => context.onEditConnection?.(conn),
    },
    {
      key: 'copy',
      label: t('connection.sidebar.menu.copy'),
      onClick: () => context.handleDuplicateConnection?.(conn),
    },
    {
      key: 'disconnect',
      label: t('connection.sidebar.menu.disconnect'),
      onClick: () => context.disconnectConnectionNode?.(node),
    },
    {
      key: 'delete',
      label: t('connection.sidebar.menu.delete'),
      danger: true,
      onClick: () => context.deleteConnectionNode?.(node),
    },
  ];
};
