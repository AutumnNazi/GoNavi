import React from 'react';
import {
  ApartmentOutlined,
  CloudServerOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import { t } from '../../i18n';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';

/**
 * XXL-JOB 调度中心的侧边栏入口。
 *
 * 三个节点是静态的：调度中心只有执行器 / 任务 / 调度日志三类视图，展开连接
 * 不需要任何网络请求，因此不进入 DBGetDatabases 与数据库节点加载流程。
 * 面板数据在双击打开对应标签页时再按需拉取。
 */

const iconColor = '#2F7DD1';

/** 节点上携带的面板标识，双击时据此打开对应工作台标签页。 */
export type XxlJobPanelKind = 'groups' | 'jobs' | 'logs';

export type XxlJobNodeDataRef = SavedConnection & {
  xxlJobPanel: XxlJobPanelKind;
};

const panelNode = (
  connection: SavedConnection,
  panel: XxlJobPanelKind,
  titleKey: string,
  icon: React.ReactNode,
): SidebarTreeNode => {
  const dataRef: XxlJobNodeDataRef = { ...connection, xxlJobPanel: panel };
  return {
    title: t(titleKey),
    key: `conn-${connection.id}-xxljob-${panel}`,
    icon,
    type: `xxljob-${panel}` as SidebarTreeNode['type'],
    dataRef,
    isLeaf: true,
  };
};

/** 生成 XXL-JOB 连接展开后的三个固定入口节点。 */
export const buildXxlJobTreeNodes = (connection: SavedConnection): SidebarTreeNode[] => [
  panelNode(
    connection,
    'groups',
    'xxljob.sidebar.executors',
    <CloudServerOutlined style={{ color: iconColor }} />,
  ),
  panelNode(
    connection,
    'jobs',
    'xxljob.sidebar.jobs',
    <ApartmentOutlined style={{ color: iconColor }} />,
  ),
  panelNode(
    connection,
    'logs',
    'xxljob.sidebar.logs',
    <ProfileOutlined style={{ color: iconColor }} />,
  ),
];

/** 判断一个连接是否为 XXL-JOB 调度中心类型。 */
export const isXxlJobConnection = (connection?: { config?: { type?: string } } | null): boolean =>
  String(connection?.config?.type || '').trim().toLowerCase() === 'xxljob';

/** 从侧边栏节点取出面板标识；不是 XXL-JOB 面板节点时返回 undefined。 */
export const xxlJobPanelOfNode = (node?: { type?: string; dataRef?: unknown } | null): XxlJobPanelKind | undefined => {
  if (!node || !String(node.type || '').startsWith('xxljob-')) return undefined;
  const panel = String(node.type).slice('xxljob-'.length);
  if (panel !== 'groups' && panel !== 'jobs' && panel !== 'logs') return undefined;
  return panel;
};
