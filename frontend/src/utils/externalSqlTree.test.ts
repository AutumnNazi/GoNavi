import { describe, expect, it } from 'vitest';

import type { ExternalSQLDirectory, ExternalSQLTreeEntry } from '../types';
import { buildExternalSQLRootNode, buildExternalSQLTabId } from './externalSqlTree';

describe('externalSqlTree helpers', () => {
  it('builds external SQL root node with nested directory and file entries', () => {
    const directories: ExternalSQLDirectory[] = [
      {
        id: 'dir-1',
        name: 'scripts',
        path: 'D:/sql/scripts',
        createdAt: 1,
      },
    ];
    const trees: Record<string, ExternalSQLTreeEntry[]> = {
      'dir-1': [
        {
          name: 'ddl',
          path: 'D:/sql/scripts/ddl',
          isDir: true,
          children: [
            {
              name: 'init.sql',
              path: 'D:/sql/scripts/ddl/init.sql',
              isDir: false,
            },
          ],
        },
      ],
    };

    const node = buildExternalSQLRootNode({
      directories,
      directoryTrees: trees,
    });

    expect(node.type).toBe('external-sql-root');
    expect(node.key).toBe('external-sql-root');
    expect(node.title).toBe('External SQL files (1)');
    expect(node.children).toHaveLength(1);
    expect(node.children?.[0]).toMatchObject({
      title: 'scripts',
      type: 'external-sql-directory',
    });
    expect(node.children?.[0].children?.[0]).toMatchObject({
      title: 'ddl',
      type: 'external-sql-folder',
    });
    expect(node.children?.[0].children?.[0].children?.[0]).toMatchObject({
      title: 'init.sql',
      type: 'external-sql-file',
    });
  });

  it('uses localized root and directory fallback labels while preserving explicit and path segment names', () => {
    const directories: ExternalSQLDirectory[] = [
      {
        id: 'dir-explicit',
        name: 'Reports',
        path: 'D:/sql/reports',
        connectionId: 'conn-1',
        dbName: 'demo',
        createdAt: 1,
      },
      {
        id: 'dir-segment',
        name: '   ',
        path: 'D:/sql/migrations',
        connectionId: 'conn-1',
        dbName: 'demo',
        createdAt: 2,
      },
      {
        id: 'dir-fallback',
        name: '',
        path: '/',
        connectionId: 'conn-1',
        dbName: 'demo',
        createdAt: 3,
      },
    ];

    const node = buildExternalSQLRootNode({
      dbNodeKey: 'conn-1-demo',
      connectionId: 'conn-1',
      dbName: 'demo',
      directories,
      directoryTrees: {},
      labels: {
        root: 'External SQL files',
        directoryFallback: 'SQL directory',
      },
    });

    expect(node.title).toBe('External SQL files (3)');
    expect(node.children?.map((child) => child.title)).toEqual([
      'migrations',
      'Reports',
      'SQL directory',
    ]);
  });

  it('builds query tab ids with connection and database isolation', () => {
    const first = buildExternalSQLTabId('conn-1', 'demo', 'D:/sql/init.sql');
    const second = buildExternalSQLTabId('conn-1', 'demo2', 'D:/sql/init.sql');

    expect(first).toContain('conn-1');
    expect(first).toContain('demo');
    expect(first).not.toBe(second);
  });

  it('keeps a directory binding ahead of the global root fallback context', () => {
    const node = buildExternalSQLRootNode({
      connectionId: 'root-connection',
      dbName: 'root_db',
      directories: [
        {
          id: 'dir-bound',
          name: 'bound scripts',
          path: 'D:/sql/bound',
          connectionId: 'connection-1',
          dbName: 'orders',
          createdAt: 1,
        },
      ],
      directoryTrees: {
        'dir-bound': [
          {
            name: 'report.sql',
            path: 'D:/sql/bound/report.sql',
            isDir: false,
          },
        ],
      },
    });

    expect(node.children?.[0]?.dataRef).toMatchObject({
      connectionId: 'connection-1',
      dbName: 'orders',
    });
    expect(node.children?.[0]?.children?.[0]?.dataRef).toMatchObject({
      connectionId: 'connection-1',
      dbName: 'orders',
    });
  });

  it('keeps same-path directories separate when they target different databases', () => {
    const node = buildExternalSQLRootNode({
      directories: [
        {
          id: 'dir-orders',
          name: 'scripts',
          path: 'D:/sql/shared',
          connectionId: 'connection-1',
          dbName: 'orders',
          createdAt: 1,
        },
        {
          id: 'dir-reporting',
          name: 'scripts',
          path: 'D:/sql/shared',
          connectionId: 'connection-2',
          dbName: 'reporting',
          createdAt: 2,
        },
      ],
      directoryTrees: {
        'dir-orders': [{ name: 'report.sql', path: 'D:/sql/shared/report.sql', isDir: false }],
        'dir-reporting': [{ name: 'report.sql', path: 'D:/sql/shared/report.sql', isDir: false }],
      },
    });

    const [orders, reporting] = node.children || [];
    expect(orders.children?.[0]?.key).not.toBe(reporting.children?.[0]?.key);
    expect(orders.children?.[0]?.dataRef).toMatchObject({
      connectionId: 'connection-1',
      dbName: 'orders',
    });
    expect(reporting.children?.[0]?.dataRef).toMatchObject({
      connectionId: 'connection-2',
      dbName: 'reporting',
    });
  });

  it('filters non-sql file entries even when the backend returns them', () => {
    const directories: ExternalSQLDirectory[] = [
      {
        id: 'dir-1',
        name: 'scripts',
        path: 'D:/sql/scripts',
        createdAt: 1,
      },
    ];
    const trees: Record<string, ExternalSQLTreeEntry[]> = {
      'dir-1': [
        {
          name: 'readme.md',
          path: 'D:/sql/scripts/readme.md',
          isDir: false,
        },
        {
          name: 'nested',
          path: 'D:/sql/scripts/nested',
          isDir: true,
          children: [
            {
              name: 'notes.txt',
              path: 'D:/sql/scripts/nested/notes.txt',
              isDir: false,
            },
            {
              name: 'report.SQL',
              path: 'D:/sql/scripts/nested/report.SQL',
              isDir: false,
            },
          ],
        },
        {
          name: 'docs',
          path: 'D:/sql/scripts/docs',
          isDir: true,
          children: [
            {
              name: 'manual.md',
              path: 'D:/sql/scripts/docs/manual.md',
              isDir: false,
            },
          ],
        },
      ],
    };

    const node = buildExternalSQLRootNode({
      directories,
      directoryTrees: trees,
    });

    const folderChildren = node.children?.[0].children || [];
    const docsFolder = folderChildren.find((child) => child.title === 'docs');
    const nestedFolder = folderChildren.find((child) => child.title === 'nested');
    expect(folderChildren).toHaveLength(2);
    expect(docsFolder).toMatchObject({
      title: 'docs',
      type: 'external-sql-folder',
    });
    expect(docsFolder?.children).toBeUndefined();
    expect(nestedFolder).toMatchObject({
      title: 'nested',
      type: 'external-sql-folder',
    });
    expect(nestedFolder?.children).toHaveLength(1);
    expect(nestedFolder?.children?.[0]).toMatchObject({
      title: 'report.SQL',
      type: 'external-sql-file',
    });
  });
});
