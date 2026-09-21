import type { ReactNode } from 'react';
import { LinkOutlined } from '@ant-design/icons';
import type { SavedConnection } from '../../types';
import {
  buildSidebarTableChildrenForUi,
  type SidebarTreeNode as TreeNode,
} from '../sidebarV2Utils';
import type { OracleDatabaseLinkEntry } from './sidebarOracleDatabaseLinks';

type SidebarDatabaseConnection = SavedConnection & { dbName?: string };

export const createSidebarObjectGroupBuilder = (conn: SidebarDatabaseConnection) => (
  parentKey: string,
  groupKey: string,
  groupTitle: string,
  groupIcon: ReactNode,
  children: TreeNode[],
  extraData: Record<string, unknown> = {},
): TreeNode => {
    const groupNodeKey = `${parentKey}-${groupKey}`;
    const groupedChildren = groupKey === 'tables'
      ? buildSidebarTableChildrenForUi(groupNodeKey, children)
      : children;
    return {
      title: groupTitle,
      key: groupNodeKey,
      icon: groupIcon,
      type: 'object-group',
      isLeaf: children.length === 0,
      children: groupedChildren.length > 0 ? groupedChildren : undefined,
      dataRef: { ...conn, dbName: conn.dbName, groupKey, ...extraData },
    };
};

export const buildOracleDatabaseLinkGroup = (
  conn: SidebarDatabaseConnection,
  parentKey: string,
  groupTitle: string,
  entries: OracleDatabaseLinkEntry[],
  schemaName = '',
): TreeNode => {
  const groupNodeKey = `${parentKey}-databaseLinks`;
  const children = entries.map((entry) => {
    const identity = `${entry.schemaName.length}:${entry.schemaName}${entry.databaseLinkName.length}:${entry.databaseLinkName}`;
    return {
      title: entry.databaseLinkName,
      key: `${groupNodeKey}-database-link-${encodeURIComponent(identity)}`,
      icon: <LinkOutlined />,
      type: 'database-link' as const,
      dataRef: {
        ...conn,
        databaseLinkName: entry.databaseLinkName,
        schemaName: entry.schemaName,
      },
      isLeaf: true,
    };
  });
  return {
    title: groupTitle,
    key: groupNodeKey,
    icon: <LinkOutlined />,
    type: 'object-group',
    isLeaf: children.length === 0,
    children: children.length > 0 ? children : undefined,
    dataRef: { ...conn, dbName: conn.dbName, groupKey: 'databaseLinks', schemaName },
  };
};
