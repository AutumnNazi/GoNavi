import { describe, expect, it } from 'vitest';

import { buildPinnedTableShortcuts, buildRecentConnectionShortcuts } from './TabManager';
import type { SavedConnection } from '../types';

const connection = (id: string, type: string): SavedConnection => ({
  id,
  name: id,
  config: {
    id,
    type,
    host: 'localhost',
    port: type === 'redis' ? 6379 : 3306,
    user: 'tester',
  },
});

describe('recent workbench shortcuts', () => {
  it('only offers connections that can open the SQL query editor', () => {
    const shortcuts = buildRecentConnectionShortcuts([
      connection('redis-1', 'redis'),
      connection('mysql-1', 'mysql'),
    ], [
      { connectionId: 'redis-1', dbName: '0', openedAt: 2 },
      { connectionId: 'mysql-1', dbName: 'orders', openedAt: 1 },
    ]);

    expect(shortcuts).toEqual([
      expect.objectContaining({
        connection: expect.objectContaining({ id: 'mysql-1' }),
        dbName: 'orders',
      }),
    ]);
  });

  it('only exposes valid pinned tables whose connection still exists', () => {
    const shortcuts = buildPinnedTableShortcuts([
      connection('mysql-1', 'mysql'),
    ], [
      JSON.stringify(['mysql-1', 'orders', 'public', 'line_items']),
      JSON.stringify(['missing-1', 'orders', '', 'orphaned_table']),
      '{bad json',
      JSON.stringify(['mysql-1', '', '', 'missing_database']),
      JSON.stringify(['mysql-1', 'orders', 'public', 'line_items']),
    ]);

    expect(shortcuts).toEqual([
      expect.objectContaining({
        connection: expect.objectContaining({ id: 'mysql-1' }),
        dbName: 'orders',
        schemaName: 'public',
        tableName: 'line_items',
      }),
    ]);
  });
});
