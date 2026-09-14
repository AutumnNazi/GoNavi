import React, { useMemo, useState } from 'react';
import { Tooltip, TreeSelect, type TreeSelectProps } from 'antd';

import {
  buildDataSyncConnectionTreeData,
  type DataSyncConnectionTreeDataNode,
} from './data-sync/DataSyncConnectionTreeSelect';
import type {
  DataSyncConnectionTreeItem,
  DataSyncSavedConnectionView,
} from './data-sync/model';
import type {
  ConnectionDisplaySortMode,
  ConnectionSortMode,
  ConnectionTag,
  SavedConnection,
} from '../types';
import { t } from '../i18n';
import {
  CONNECTION_SELECTION_KEY_PREFIX,
  GROUP_SELECTION_KEY_PREFIX,
} from './batchConnectionSelectionTree';
import {
  buildSidebarConnectionTagTree,
  type SidebarConnectionTagTreeItem,
} from './sidebarV2Utils';
import { resolveConnectionIconType } from '../utils/connectionVisual';
import { resolveConnectionHostSummary } from '../utils/tabDisplay';
import { hintTooltipTiming } from './common/tooltipTiming';
import './data-sync/DataSyncWorkbench.css';
import './BatchConnectionTreeSelect.css';

const BrowserSafeTreeSelect: React.FC<
  TreeSelectProps<string, DataSyncConnectionTreeDataNode>
> = (props) => {
  if (typeof window === 'undefined' || typeof HTMLElement === 'undefined') {
    return React.createElement('gn-data-sync-tree-select', props);
  }
  return <TreeSelect<string, DataSyncConnectionTreeDataNode> {...props} />;
};

const projectSidebarItem = (
  item: SidebarConnectionTagTreeItem,
): DataSyncConnectionTreeItem =>
  item.kind === 'connection'
    ? { kind: 'connection', connectionId: item.id }
    : {
        kind: 'group',
        id: item.id,
        name: item.tag.name,
        children: item.children.map(projectSidebarItem),
      };

export const buildBatchConnectionTreeLayout = ({
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
}): DataSyncConnectionTreeItem[] =>
  buildSidebarConnectionTagTree(
    connections,
    connectionTags,
    sidebarRootOrder,
    rootSortMode,
    rootConnectionSortMode,
  ).map(projectSidebarItem);

export const toBatchConnectionViews = (
  connections: SavedConnection[],
): DataSyncSavedConnectionView[] =>
  connections.map((connection) => ({
    id: connection.id,
    name: connection.name || connection.id,
    type: resolveConnectionIconType(connection),
    readable: true,
    writable: true,
  }));

const connectionIdFromValue = (value: string): string =>
  value.startsWith(CONNECTION_SELECTION_KEY_PREFIX)
    ? value.slice(CONNECTION_SELECTION_KEY_PREFIX.length)
    : '';

const connectionCountOf = (node: DataSyncConnectionTreeDataNode): number => {
  if (!node.children?.length) {
    return node.value.startsWith(CONNECTION_SELECTION_KEY_PREFIX) ? 1 : 0;
  }
  return node.children.reduce((total, child) => total + connectionCountOf(child), 0);
};

const resolveConnectionEndpoint = (connection: SavedConnection): string => {
  const summary = resolveConnectionHostSummary(connection.config);
  const port = Number(connection.config?.port);
  if (!summary) return '';
  if (summary.includes('+') || summary.includes(':') || !Number.isFinite(port) || port <= 0) {
    return summary;
  }
  return `${summary}:${port}`;
};

const resolveConnectionDatabase = (connection: SavedConnection): string => {
  const database = String(connection.config?.database || '').trim();
  if (database) return database;
  if (connection.config?.redisDB === undefined || connection.config?.redisDB === null) {
    return '';
  }
  return String(connection.config.redisDB);
};

export type BatchConnectionHoverModel = {
  kind: 'connection' | 'group';
  badge?: string;
  title: string;
  rows: Array<[string, string]>;
};

export const buildBatchConnectionHoverModel = (
  connection: SavedConnection,
  groupName = '',
): BatchConnectionHoverModel => {
  const host = resolveConnectionEndpoint(connection);
  const database = resolveConnectionDatabase(connection);
  return {
    kind: 'connection',
    title: connection.name || connection.id,
    rows: [
      [t('app.theme.tab_display.element.host.label'), host],
      [t('tab_manager.hover.label.database'), database],
      [t('app.theme.tab_display.element.group.label'), groupName],
    ].filter(([, value]) => Boolean(value)),
  };
};

export const buildBatchGroupHoverModel = (
  name: string,
  connectionCount: number,
): BatchConnectionHoverModel => ({
  kind: 'group',
  badge: t('connection.sidebar.group.badge'),
  title: name,
  rows: [
    [t('data_export.label.connection'), String(connectionCount)],
  ].filter(([, value]) => Boolean(value)),
});

const BatchConnectionHoverCard: React.FC<BatchConnectionHoverModel> = ({
  kind,
  badge,
  title,
  rows,
}) => (
  <div className="gn-v2-tab-hover-card" data-batch-connection-hover={kind}>
    <div className="gn-v2-tab-hover-head" data-has-badge={badge ? 'true' : 'false'}>
      {badge ? <span>{badge}</span> : null}
      <strong>{title}</strong>
    </div>
    {rows.length > 0 ? (
      <div className="gn-v2-tab-hover-rows">
        {rows.map(([label, value], index) => (
          <div className="gn-v2-tab-hover-row" key={`${label}-${index}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

const wrapHoverTitle = (
  content: React.ReactNode,
  model: BatchConnectionHoverModel,
): React.ReactNode => (
  <Tooltip
    title={<BatchConnectionHoverCard {...model} />}
    placement="right"
    align={{ offset: [10, 0] }}
    {...hintTooltipTiming}
    destroyOnHidden
    rootClassName="gn-v2-tab-hover-tooltip gn-batch-connection-hover-tooltip"
    getPopupContainer={() => document.body}
    zIndex={1300}
  >
    <span
      className="gn-batch-connection-tree-node-hover"
      data-batch-connection-hover-trigger={model.kind}
    >
      {content}
    </span>
  </Tooltip>
);

export const attachBatchConnectionHoverTitles = (
  nodes: DataSyncConnectionTreeDataNode[],
  connections: SavedConnection[],
  groupName = '',
): DataSyncConnectionTreeDataNode[] => {
  const connectionById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );

  const decorate = (
    items: DataSyncConnectionTreeDataNode[],
    currentGroupName: string,
  ): DataSyncConnectionTreeDataNode[] =>
    items.map((node) => {
      if (node.children?.length) {
        const nextGroupName = node.label || currentGroupName;
        return {
          ...node,
          title: wrapHoverTitle(
            node.title,
            buildBatchGroupHoverModel(nextGroupName, connectionCountOf(node)),
          ),
          children: decorate(node.children, nextGroupName),
        };
      }
      const connection = connectionById.get(connectionIdFromValue(node.value));
      if (!connection) return node;
      return {
        ...node,
        title: wrapHoverTitle(
          node.title,
          buildBatchConnectionHoverModel(connection, currentGroupName),
        ),
      };
    });

  return decorate(nodes, groupName);
};

export const connectionIdsFromTreeSelectValues = (
  values: Array<string | number> | undefined,
  treeData: DataSyncConnectionTreeDataNode[],
  connections: SavedConnection[],
): string[] => {
  const existingIds = new Set(connections.map((connection) => connection.id));
  const nodeByValue = new Map<string, DataSyncConnectionTreeDataNode>();
  const index = (nodes: DataSyncConnectionTreeDataNode[]) => {
    nodes.forEach((node) => {
      nodeByValue.set(node.value, node);
      if (node.children) index(node.children);
    });
  };
  index(treeData);

  const seen = new Set<string>();
  const ids: string[] = [];
  const addId = (connectionId: string) => {
    if (!connectionId || !existingIds.has(connectionId) || seen.has(connectionId)) {
      return;
    }
    seen.add(connectionId);
    ids.push(connectionId);
  };
  const addFromNode = (node: DataSyncConnectionTreeDataNode | undefined) => {
    if (!node) return;
    if (node.children?.length) {
      node.children.forEach(addFromNode);
      return;
    }
    addId(connectionIdFromValue(node.value));
  };

  (Array.isArray(values) ? values : []).forEach((raw) => {
    const value = String(raw || '');
    if (value.startsWith(CONNECTION_SELECTION_KEY_PREFIX)) {
      addId(connectionIdFromValue(value));
      return;
    }
    if (value.startsWith(GROUP_SELECTION_KEY_PREFIX)) {
      addFromNode(nodeByValue.get(value));
    }
  });
  return ids;
};

const firstMatchingConnectionValue = (
  treeData: DataSyncConnectionTreeDataNode[],
  input: string,
): string | null => {
  const normalizedInput = input.trim().toLocaleLowerCase();
  if (!normalizedInput) return null;

  for (const node of treeData) {
    if (node.children) {
      const childMatch = firstMatchingConnectionValue(node.children, normalizedInput);
      if (childMatch) return childMatch;
      continue;
    }
    if (!node.disabled && node.searchText.includes(normalizedInput)) {
      return node.value;
    }
  }
  return null;
};

export const BatchConnectionTreeSelect: React.FC<{
  connections: SavedConnection[];
  connectionTags?: ConnectionTag[];
  sidebarRootOrder?: string[];
  rootSortMode?: ConnectionSortMode;
  rootConnectionSortMode?: ConnectionDisplaySortMode;
  value: string[];
  disabled?: boolean;
  placeholder: string;
  emptyText: string;
  onChange: (connectionIds: string[]) => void;
}> = ({
  connections,
  connectionTags = [],
  sidebarRootOrder = [],
  rootSortMode = 'manual',
  rootConnectionSortMode = 'createdAt',
  value,
  disabled = false,
  placeholder,
  emptyText,
  onChange,
}) => {
  const connectionViews = useMemo(
    () => toBatchConnectionViews(connections),
    [connections],
  );
  const layout = useMemo(
    () =>
      buildBatchConnectionTreeLayout({
        connections,
        connectionTags,
        sidebarRootOrder,
        rootSortMode,
        rootConnectionSortMode,
      }),
    [connectionTags, connections, rootConnectionSortMode, rootSortMode, sidebarRootOrder],
  );
  const treeData = useMemo(
    () => attachBatchConnectionHoverTitles(
      buildDataSyncConnectionTreeData(layout, connectionViews),
      connections,
    ),
    [connectionViews, connections, layout],
  );
  const selectedValues = useMemo(
    () => value.map((connectionId) => `${CONNECTION_SELECTION_KEY_PREFIX}${connectionId}`),
    [value],
  );
  const [expandedGroupValues, setExpandedGroupValues] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState('');

  const commitValues = (next: Array<string | number> | undefined) => {
    onChange(connectionIdsFromTreeSelectValues(next, treeData, connections));
  };

  return (
    <BrowserSafeTreeSelect
      className="gn-data-sync-connection-tree-select"
      classNames={{
        popup: {
          root: 'gn-data-sync-connection-tree-popup gn-batch-connection-tree-popup',
        },
      }}
      data-batch-connection-tree="true"
      multiple
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_CHILD}
      treeNodeLabelProp="label"
      maxTagCount="responsive"
      value={selectedValues}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={value.length > 0}
      treeData={treeData}
      treeExpandedKeys={searchValue ? undefined : expandedGroupValues}
      onTreeExpand={(expandedKeys) => {
        if (!searchValue) setExpandedGroupValues(expandedKeys.map(String));
      }}
      treeExpandAction="click"
      listHeight={280}
      popupMatchSelectWidth
      showSearch
      treeNodeFilterProp="searchText"
      searchValue={searchValue}
      onSearch={setSearchValue}
      filterTreeNode={(input, node) =>
        Boolean(input.trim()) &&
        node.searchText.includes(input.trim().toLocaleLowerCase())
      }
      notFoundContent={emptyText}
      onInputKeyDown={(event) => {
        if (event.key !== 'Enter' || !searchValue) return;
        const match = firstMatchingConnectionValue(treeData, searchValue);
        if (!match?.startsWith(CONNECTION_SELECTION_KEY_PREFIX)) return;
        const connectionId = connectionIdFromValue(match);
        if (!connections.some((connection) => connection.id === connectionId)) return;

        event.preventDefault();
        event.stopPropagation();
        setSearchValue('');
        event.currentTarget.blur();
        onChange(Array.from(new Set([...value, connectionId])));
      }}
      onChange={(next) => {
        setSearchValue('');
        if (!next) {
          onChange([]);
          return;
        }
        commitValues(Array.isArray(next) ? next : [next]);
      }}
    />
  );
};
