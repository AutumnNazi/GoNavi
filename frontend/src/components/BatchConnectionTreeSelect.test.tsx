import { describe, expect, it } from 'vitest';

import {
  attachBatchConnectionHoverTitles,
  buildBatchConnectionHoverModel,
  buildBatchConnectionTreeLayout,
  buildBatchGroupHoverModel,
  connectionIdsFromTreeSelectValues,
  toBatchConnectionViews,
} from './BatchConnectionTreeSelect';
import { buildDataSyncConnectionTreeData, type DataSyncConnectionTreeDataNode } from './data-sync/DataSyncConnectionTreeSelect';
import type { ConnectionTag, SavedConnection } from '../types';
import { setCurrentLanguage } from '../i18n';

const connections = [
  { id: 'conn-1', name: 'Local', config: { type: 'mysql', host: 'localhost', port: 3306 } },
  { id: 'conn-2', name: 'Prod', config: { type: 'postgres', host: 'db.example.com', port: 5432 } },
  { id: 'conn-3', name: 'Cache', config: { type: 'redis', host: '127.0.0.1', port: 6379 } },
  { id: 'elastic', name: 'Elasticsearch', config: { type: 'elasticsearch' } },
] as SavedConnection[];

const outline = (nodes: DataSyncConnectionTreeDataNode[]): unknown[] =>
  nodes.map((node) =>
    node.children
      ? {
          value: node.value,
          selectable: node.selectable,
          label: node.label,
          children: outline(node.children),
        }
      : node.value,
  );

describe('BatchConnectionTreeSelect helpers', () => {
  it('projects sidebar groups the same way as the data-sync connection picker', () => {
    const tags = [
      {
        id: 'bero',
        name: 'BeroHost-测试',
        connectionIds: ['elastic', 'conn-2'],
        childOrder: ['connection:elastic', 'connection:conn-2'],
      },
    ] as ConnectionTag[];
    const treeData = buildDataSyncConnectionTreeData(
      buildBatchConnectionTreeLayout({
        connections,
        connectionTags: tags,
        rootConnectionSortMode: 'name',
      }),
      toBatchConnectionViews(connections),
    );

    expect(outline(treeData)).toEqual([
      {
        value: 'group:bero',
        selectable: false,
        label: 'BeroHost-测试',
        children: ['connection:elastic', 'connection:conn-2'],
      },
      'connection:conn-3',
      'connection:conn-1',
    ]);
    expect(treeData[0].children?.[0].searchText).toContain('elasticsearch');
    expect(treeData[0].children?.[0].label).toBe('Elasticsearch');
  });

  it('expands a checked group value into every descendant connection', () => {
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1', 'conn-2'] },
    ] as ConnectionTag[];
    const treeData = buildDataSyncConnectionTreeData(
      buildBatchConnectionTreeLayout({ connections, connectionTags: tags }),
      toBatchConnectionViews(connections),
    );

    expect(connectionIdsFromTreeSelectValues(['group:dev'], treeData, connections)).toEqual([
      'conn-1',
      'conn-2',
    ]);
    expect(connectionIdsFromTreeSelectValues(
      ['connection:conn-3', 'group:dev'],
      treeData,
      connections,
    )).toEqual(['conn-3', 'conn-1', 'conn-2']);
  });

  it('builds hover metadata with the full connection name, host, and group', () => {
    setCurrentLanguage('zh-CN');
    expect(buildBatchConnectionHoverModel(connections[0], 'BeroHost-测试')).toEqual({
      kind: 'connection',
      title: 'Local',
      rows: [
        ['Host/IP', 'localhost:3306'],
        ['分组', 'BeroHost-测试'],
      ],
    });
    expect(buildBatchGroupHoverModel('BeroHost-测试', 2)).toEqual({
      kind: 'group',
      badge: '分组',
      title: 'BeroHost-测试',
      rows: [['连接', '2']],
    });
  });

  it('wraps truncated tree titles so hover can show the full metadata card', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      {
        id: 'bero',
        name: 'BeroHost-测试',
        connectionIds: ['elastic', 'conn-2'],
        childOrder: ['connection:elastic', 'connection:conn-2'],
      },
    ] as ConnectionTag[];
    const decorated = attachBatchConnectionHoverTitles(
      buildDataSyncConnectionTreeData(
        buildBatchConnectionTreeLayout({
          connections,
          connectionTags: tags,
          rootConnectionSortMode: 'name',
        }),
        toBatchConnectionViews(connections),
      ),
      connections,
    );
    const groupTitle = decorated[0].title as any;
    const connectionTitle = decorated[0].children?.[0].title as any;

    expect(groupTitle.props.children.props['data-batch-connection-hover-trigger']).toBe('group');
    expect(groupTitle.props.title.props).toMatchObject({
      kind: 'group',
      title: 'BeroHost-测试',
      rows: [['连接', '2']],
    });
    expect(connectionTitle.props.children.props['data-batch-connection-hover-trigger']).toBe('connection');
    expect(connectionTitle.props.title.props.title).toBe('Elasticsearch');
    expect(connectionTitle.props.title.props.rows).toEqual([
      ['分组', 'BeroHost-测试'],
    ]);
  });
});
