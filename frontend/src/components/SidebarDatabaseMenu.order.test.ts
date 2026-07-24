import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildSidebarLegacyNodeMenuItems } from './sidebar/sidebarLegacyNodeMenu';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');

describe('Sidebar legacy database menu order', () => {
  it('keeps copy database name first and query actions ahead of close database', () => {
    const databaseMenuStart = source.indexOf("} else if (node.type === 'database') {");
    const databaseMenuEnd = source.indexOf("} else if (node.type === 'view') {", databaseMenuStart);

    expect(databaseMenuStart).toBeGreaterThanOrEqual(0);
    expect(databaseMenuEnd).toBeGreaterThan(databaseMenuStart);

    const databaseMenuSource = source.slice(databaseMenuStart, databaseMenuEnd);
    const copyDatabaseNameIndex = databaseMenuSource.indexOf("key: 'copy-database-name'");
    const newQueryIndex = databaseMenuSource.indexOf("key: 'new-query'");
    const runSqlIndex = databaseMenuSource.indexOf("key: 'run-sql'");
    const disconnectIndex = databaseMenuSource.indexOf("key: 'disconnect-db'");

    expect(copyDatabaseNameIndex).toBeGreaterThanOrEqual(0);
    expect(newQueryIndex).toBeGreaterThanOrEqual(0);
    expect(runSqlIndex).toBeGreaterThanOrEqual(0);
    expect(disconnectIndex).toBeGreaterThanOrEqual(0);
    expect(copyDatabaseNameIndex).toBeLessThan(newQueryIndex);
    expect(newQueryIndex).toBeLessThan(disconnectIndex);
    expect(runSqlIndex).toBeLessThan(disconnectIndex);
  });

  it('routes copy database name through the shared database action handler', () => {
    const handleV2DatabaseContextMenuAction = vi.fn();
    const node = {
      type: 'database',
      title: 'main_db',
      dataRef: { id: 'mysql-1', dbName: 'main_db', config: { type: 'mysql' } },
    };
    const items = buildSidebarLegacyNodeMenuItems(node, {
      getMetadataDialect: () => 'mysql',
      isPostgresSchemaDialect: () => false,
      shouldHideSchemaPrefix: () => false,
      isStructureOnlyDbType: () => false,
      handleV2DatabaseContextMenuAction,
    }) as Array<{ key?: string; onClick?: () => void }>;

    const copyItem = items.find((item) => item?.key === 'copy-database-name');
    expect(copyItem).toBeTruthy();

    copyItem?.onClick?.();

    expect(handleV2DatabaseContextMenuAction).toHaveBeenCalledWith(node, 'copy-database-name');
  });
});
