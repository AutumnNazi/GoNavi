import { describe, expect, it, vi } from 'vitest';

import { buildSidebarLegacyNodeMenuItems } from './sidebarLegacyNodeMenu';

const buildConnectionRootItems = (connection: any) =>
  buildSidebarLegacyNodeMenuItems({
    key: connection.id,
    type: 'connection',
    dataRef: connection,
  }, {
    addTab: vi.fn(),
    loadDatabases: vi.fn(),
    handleRunSQLFile: vi.fn(),
    buildConnectionRootQueryTabTitle: vi.fn(() => 'query'),
    connectionTags: [],
  }) as any[];

const itemKeys = (items: any[]) => items.map((item) => item?.key);

describe('connection root menu query entry gating', () => {
  it('hides new query and run SQL file for JVM connections', () => {
    const items = buildConnectionRootItems({
      id: 'jvm-1',
      name: 'JVM workbench',
      config: { type: 'jvm', host: '127.0.0.1', port: 8080 },
    });
    expect(itemKeys(items)).not.toContain('new-query');
    expect(itemKeys(items)).not.toContain('open-sql-file');
  });

  it('keeps new query and run SQL file for SQL connections', () => {
    const items = buildConnectionRootItems({
      id: 'mysql-1',
      name: 'MySQL dev',
      config: { type: 'mysql', host: '127.0.0.1', port: 3306 },
    });
    expect(itemKeys(items)).toContain('new-query');
    expect(itemKeys(items)).toContain('open-sql-file');
  });

  it('keeps new query for currently queryable messaging and vector connections', () => {
    [
      { type: 'mqtt', host: '127.0.0.1', port: 1883 },
      { type: 'rocketmq', host: '127.0.0.1', port: 9876 },
      { type: 'chroma', host: '127.0.0.1', port: 8000 },
      { type: 'elasticsearch', host: '127.0.0.1', port: 9200 },
      { type: 'mongodb', host: '127.0.0.1', port: 27017 },
    ].forEach((config, index) => {
      const items = buildConnectionRootItems({
        id: `query-capable-${index}`,
        name: `query capable ${index}`,
        config,
      });
      expect(itemKeys(items), JSON.stringify(config)).toContain('new-query');
      expect(itemKeys(items), JSON.stringify(config)).toContain('open-sql-file');
    });
  });
});
