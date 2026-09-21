import { describe, expect, it } from 'vitest';
import { EyeOutlined } from '@ant-design/icons';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import {
  buildOracleDatabaseLinkGroup,
  createSidebarObjectGroupBuilder,
} from './sidebarObjectGroup';

const connection = {
  id: 'conn-oracle',
  name: 'Oracle',
  dbName: 'SCOTT',
  config: { type: 'oracle', host: '127.0.0.1', port: 1521, user: 'scott', database: 'ORCL' },
} as unknown as SavedConnection & { dbName?: string };

const viewNode: SidebarTreeNode = {
  title: 'V_EMP',
  key: 'conn-oracle-SCOTT-view-V_EMP',
  type: 'view',
  isLeaf: true,
  dataRef: { ...connection, viewName: 'V_EMP' },
};

describe('createSidebarObjectGroupBuilder', () => {
  it('builds an object-group node carrying the connection, dbName, groupKey and extra data', () => {
    const buildObjectGroup = createSidebarObjectGroupBuilder(connection);

    const group = buildObjectGroup('parent', 'views', 'Views', <EyeOutlined />, [viewNode], { schemaName: 'SCOTT' });

    expect(group.key).toBe('parent-views');
    expect(group.type).toBe('object-group');
    expect(group.isLeaf).toBe(false);
    expect(group.children).toEqual([viewNode]);
    expect(group.dataRef).toMatchObject({ id: 'conn-oracle', dbName: 'SCOTT', groupKey: 'views', schemaName: 'SCOTT' });
  });

  it('marks an empty group as a leaf without a children array', () => {
    const group = createSidebarObjectGroupBuilder(connection)('parent', 'routines', 'Routines', <EyeOutlined />, []);

    expect(group.isLeaf).toBe(true);
    expect(group.children).toBeUndefined();
  });
});

describe('buildOracleDatabaseLinkGroup', () => {
  it('renders one leaf per link and keeps dotted link names whole', () => {
    const group = buildOracleDatabaseLinkGroup(connection, 'parent', 'Database links', [
      { schemaName: 'SCOTT', databaseLinkName: 'FCCS_FCKF222' },
      { schemaName: 'SCOTT', databaseLinkName: 'ORCL.WORLD' },
    ], 'SCOTT');

    expect(group.key).toBe('parent-databaseLinks');
    expect(group.type).toBe('object-group');
    expect(group.isLeaf).toBe(false);
    expect(group.dataRef).toMatchObject({ id: 'conn-oracle', dbName: 'SCOTT', groupKey: 'databaseLinks', schemaName: 'SCOTT' });

    const children = group.children || [];
    expect(children.map((node) => node.title)).toEqual(['FCCS_FCKF222', 'ORCL.WORLD']);
    expect(children.every((node) => node.type === 'database-link' && node.isLeaf)).toBe(true);
    expect(new Set(children.map((node) => node.key)).size).toBe(2);
    expect(children[1].dataRef).toMatchObject({
      id: 'conn-oracle',
      dbName: 'SCOTT',
      schemaName: 'SCOTT',
      databaseLinkName: 'ORCL.WORLD',
    });
  });

  it('keeps the group visible as an empty leaf when the schema owns no links', () => {
    const group = buildOracleDatabaseLinkGroup(connection, 'parent', 'Database links', []);

    expect(group.isLeaf).toBe(true);
    expect(group.children).toBeUndefined();
    expect(group.dataRef).toMatchObject({ groupKey: 'databaseLinks', schemaName: '' });
  });
});
