import { describe, expect, it } from 'vitest';

import {
  filterSidebarTreeByHiddenObjectGroups,
  sanitizeSidebarHiddenObjectGroups,
} from './sidebarObjectVisibility';

describe('sidebar object visibility', () => {
  it('keeps only enabled object categories while preserving the source tree', () => {
    const tree = [{
      key: 'db',
      type: 'database',
      children: [
        { key: 'db-queries', type: 'queries-folder', children: [{ key: 'query-1', type: 'saved-query' }] },
        { key: 'db-tables', type: 'object-group', dataRef: { groupKey: 'tables' }, children: [{ key: 'orders', type: 'table' }] },
        { key: 'db-views', type: 'object-group', dataRef: { groupKey: 'views' } },
        {
          key: 'db-schema-dbo',
          type: 'object-group',
          dataRef: { groupKey: 'schema' },
          children: [
            { key: 'dbo-tables', type: 'object-group', dataRef: { groupKey: 'tables' }, children: [{ key: 'customers', type: 'table' }] },
            { key: 'dbo-events', type: 'object-group', dataRef: { groupKey: 'events' } },
          ],
        },
      ],
    }];

    const filtered = filterSidebarTreeByHiddenObjectGroups(tree, [
      'savedQueries',
      'views',
      'events',
    ]);

    expect(filtered[0].children?.map((node) => node.key)).toEqual(['db-tables', 'db-schema-dbo']);
    expect(filtered[0].children?.[1].children?.map((node) => node.key)).toEqual(['dbo-tables']);
    expect(tree[0].children?.map((node) => node.key)).toEqual([
      'db-queries',
      'db-tables',
      'db-views',
      'db-schema-dbo',
    ]);
  });

  it('keeps filtered descendants when wrapper child counts stay unchanged', () => {
    const tree = [{
      key: 'connection-1',
      type: 'connection',
      children: [{
        key: 'database-1',
        type: 'database',
        children: [
          { key: 'database-1-tables', type: 'object-group', dataRef: { groupKey: 'tables' } },
          { key: 'database-1-views', type: 'object-group', dataRef: { groupKey: 'views' } },
          { key: 'database-1-routines', type: 'object-group', dataRef: { groupKey: 'routines' } },
        ],
      }],
    }];

    const filtered = filterSidebarTreeByHiddenObjectGroups(tree, ['views', 'routines']);

    expect(filtered[0].children?.[0].children?.map((node) => node.key)).toEqual([
      'database-1-tables',
    ]);
    expect(filtered[0]).not.toBe(tree[0]);
    expect(filtered[0].children?.[0]).not.toBe(tree[0].children[0]);
  });

  it('keeps deeply filtered schema descendants through tag and connection wrappers', () => {
    const tree = [{
      key: 'tag-1',
      type: 'tag',
      children: [{
        key: 'connection-1',
        type: 'connection',
        children: [{
          key: 'database-1',
          type: 'database',
          children: [{
            key: 'database-1-public',
            type: 'object-group',
            dataRef: { groupKey: 'schema' },
            children: [
              { key: 'public-tables', type: 'object-group', dataRef: { groupKey: 'tables' } },
              { key: 'public-events', type: 'object-group', dataRef: { groupKey: 'events' } },
            ],
          }],
        }],
      }],
    }];

    const filtered = filterSidebarTreeByHiddenObjectGroups(tree, ['events']);

    expect(filtered[0].children?.[0].children?.[0].children?.[0].children?.map((node) => node.key)).toEqual([
      'public-tables',
    ]);
  });

  it('drops invalid and duplicate persisted object group keys', () => {
    expect(sanitizeSidebarHiddenObjectGroups([
      'views',
      'views',
      'unknown',
      3,
      ' tables ',
    ])).toEqual(['views', 'tables']);
  });
});
