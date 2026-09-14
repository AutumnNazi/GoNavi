import type { ConnectionDisplaySortMode, ConnectionSortMode, ConnectionTag, SavedConnection } from '../types';
import { t } from '../i18n';
import { resolveConnectionIconType } from '../utils/connectionVisual';
import { resolveConnectionHostSummary } from '../utils/tabDisplay';
import { V2_RAIL_UNGROUPED_CONNECTION_GROUP_ID } from './sidebar/sidebarHelpers';
import { buildV2RailConnectionGroups, type V2RailConnectionGroup } from './sidebarV2Utils';

export const UNGROUPED_GROUP_ID = V2_RAIL_UNGROUPED_CONNECTION_GROUP_ID;
export const CONNECTION_SELECTION_KEY_PREFIX = 'connection:';
export const GROUP_SELECTION_KEY_PREFIX = 'group:';

export type BatchConnectionSelectionNode = {
  key: string;
  title: string;
  searchText: string;
  connectionCount: number;
  connectionId?: string;
  groupId?: string;
  children?: BatchConnectionSelectionNode[];
};

const connectionSelectionKey = (connectionId: string): string => (
  `${CONNECTION_SELECTION_KEY_PREFIX}${connectionId}`
);

export const groupSelectionKey = (groupId: string): string => (
  `${GROUP_SELECTION_KEY_PREFIX}${groupId}`
);

export const isConnectionSelectionKey = (key: string): boolean => (
  String(key || '').startsWith(CONNECTION_SELECTION_KEY_PREFIX)
);

export const connectionIdFromSelectionKey = (key: string): string => (
  String(key || '').slice(CONNECTION_SELECTION_KEY_PREFIX.length)
);

const formatGroupTitle = (name: string, count: number): string => (
  t('data_export.workbench.group.count_label', { name, count })
);

const connectionSearchText = (connection: SavedConnection): string => (
  [
    connection.name,
    resolveConnectionIconType(connection),
    resolveConnectionHostSummary(connection.config),
  ].filter(Boolean).join(' ')
);

const buildConnectionNode = (connection: SavedConnection): BatchConnectionSelectionNode => ({
  key: connectionSelectionKey(connection.id),
  title: connection.name,
  searchText: connectionSearchText(connection),
  connectionCount: 1,
  connectionId: connection.id,
});

const buildGroupNode = (
  groupId: string,
  name: string,
  children: BatchConnectionSelectionNode[],
): BatchConnectionSelectionNode | null => {
  const connectionCount = children.reduce((total, child) => total + child.connectionCount, 0);
  if (connectionCount === 0) return null;
  return {
    key: groupSelectionKey(groupId),
    title: formatGroupTitle(name, connectionCount),
    searchText: name,
    connectionCount,
    groupId,
    children,
  };
};

const buildGroupFromRail = (group: V2RailConnectionGroup): BatchConnectionSelectionNode | null => {
  const childNodes = [
    ...(group.directConnections || []).map(buildConnectionNode),
    ...(group.children || []).map(buildGroupFromRail).filter((node): node is BatchConnectionSelectionNode => Boolean(node)),
  ];
  const name = String(group.name || '').trim() || t('connection.sidebar.group.untitled');
  return buildGroupNode(group.id, name, childNodes);
};

export const buildBatchConnectionSelectionTree = ({
  connections,
  connectionTags = [],
  sidebarRootOrder = [],
  rootSortMode = 'manual',
  rootConnectionSortMode = 'createdAt',
}: {
  connections: SavedConnection[];
  connectionTags?: ConnectionTag[];
  sidebarRootOrder?: string[];
  rootSortMode?: ConnectionSortMode;
  rootConnectionSortMode?: ConnectionDisplaySortMode;
}): BatchConnectionSelectionNode[] => {
  const railGroups = buildV2RailConnectionGroups(
    connections,
    connectionTags,
    sidebarRootOrder,
    rootSortMode,
    rootConnectionSortMode,
  );
  const nodes: BatchConnectionSelectionNode[] = [];
  const ungroupedConnections: SavedConnection[] = [];

  railGroups.forEach((group) => {
    if (group.isUngrouped) {
      ungroupedConnections.push(...(group.directConnections || group.connections));
      return;
    }
    const node = buildGroupFromRail(group);
    if (node) nodes.push(node);
  });

  const ungroupedNode = buildGroupNode(
    UNGROUPED_GROUP_ID,
    t('connection.sidebar.management.ungrouped'),
    ungroupedConnections.map(buildConnectionNode),
  );
  if (ungroupedNode) nodes.push(ungroupedNode);
  return nodes;
};

export const collectConnectionIdsFromTree = (nodes: BatchConnectionSelectionNode[]): string[] => {
  const ids: string[] = [];
  const walk = (node: BatchConnectionSelectionNode) => {
    if (node.connectionId) {
      ids.push(node.connectionId);
      return;
    }
    (node.children || []).forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
};

export const collectConnectionIdsFromCheckedKeys = (
  keys: Array<string | number> | undefined,
  connections: SavedConnection[],
): string[] => {
  const existingIds = new Set(connections.map((connection) => connection.id));
  const seen = new Set<string>();
  const ids: string[] = [];
  (Array.isArray(keys) ? keys : []).forEach((rawKey) => {
    const key = String(rawKey || '');
    if (!isConnectionSelectionKey(key)) return;
    const connectionId = connectionIdFromSelectionKey(key);
    if (!connectionId || !existingIds.has(connectionId) || seen.has(connectionId)) return;
    seen.add(connectionId);
    ids.push(connectionId);
  });
  return ids;
};

export const deriveCheckedKeys = (
  nodes: BatchConnectionSelectionNode[],
  selectedConnectionIds: string[],
): string[] => {
  const selected = new Set(selectedConnectionIds);
  const keys: string[] = [];
  const walk = (node: BatchConnectionSelectionNode): { all: boolean; none: boolean } => {
    if (node.connectionId) {
      const checked = selected.has(node.connectionId);
      if (checked) keys.push(node.key);
      return { all: checked, none: !checked };
    }
    const children = node.children || [];
    if (children.length === 0) return { all: false, none: true };
    const results = children.map(walk);
    const all = results.every((item) => item.all);
    const none = results.every((item) => item.none);
    if (all) keys.push(node.key);
    return { all, none };
  };
  nodes.forEach(walk);
  return keys;
};

const isNodeFullySelected = (
  node: BatchConnectionSelectionNode,
  selected: Set<string>,
): boolean => {
  if (node.connectionId) return selected.has(node.connectionId);
  const children = node.children || [];
  return children.length > 0 && children.every((child) => isNodeFullySelected(child, selected));
};

export const collectFullySelectedGroupNames = (
  nodes: BatchConnectionSelectionNode[],
  selectedConnectionIds: string[],
): string[] => {
  const selected = new Set(selectedConnectionIds);
  const names: string[] = [];
  const collect = (node: BatchConnectionSelectionNode) => {
    if (node.connectionId) return;
    if (isNodeFullySelected(node, selected) && node.groupId && node.connectionCount > 0) {
      names.push(String(node.searchText || node.title).trim());
      return;
    }
    (node.children || []).forEach(collect);
  };
  nodes.forEach(collect);
  return names;
};

export const collectGroupKeys = (nodes: BatchConnectionSelectionNode[]): string[] => {
  const keys: string[] = [];
  const walk = (node: BatchConnectionSelectionNode) => {
    if (node.groupId) keys.push(node.key);
    (node.children || []).forEach(walk);
  };
  nodes.forEach(walk);
  return keys;
};

export const filterBatchConnectionSelectionTree = (
  nodes: BatchConnectionSelectionNode[],
  query: string,
): BatchConnectionSelectionNode[] => {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return nodes;

  const matches = (node: BatchConnectionSelectionNode): boolean => (
    node.title.toLowerCase().includes(normalized)
    || node.searchText.toLowerCase().includes(normalized)
  );

  const walk = (node: BatchConnectionSelectionNode): BatchConnectionSelectionNode | null => {
    if (matches(node) && node.groupId) {
      return node;
    }
    if (!node.children || node.children.length === 0) {
      return matches(node) ? node : null;
    }
    const children = node.children.map(walk).filter((child): child is BatchConnectionSelectionNode => Boolean(child));
    if (children.length === 0) return null;
    return {
      ...node,
      children,
      connectionCount: children.reduce((total, child) => total + child.connectionCount, 0),
    };
  };

  return nodes.map(walk).filter((node): node is BatchConnectionSelectionNode => Boolean(node));
};
