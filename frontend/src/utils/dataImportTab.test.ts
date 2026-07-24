import { describe, expect, it } from 'vitest';

import {
  buildDataImportWorkbenchTab,
  DATA_IMPORT_WORKBENCH_TAB_ID,
  resolveDataImportWorkbenchLaunchTab,
} from './dataImportTab';

describe('dataImportTab', () => {
  it('builds one stable workbench tab with a normalized target', () => {
    const tab = buildDataImportWorkbenchTab({
      connectionId: ' conn-1 ',
      dbName: ' app ',
      tableName: ' public.users ',
      launchKey: ' launch-table-1 ',
      title: ' 数据导入 ',
    });

    expect(tab).toMatchObject({
      id: DATA_IMPORT_WORKBENCH_TAB_ID,
      title: '数据导入',
      type: 'data-import',
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'public.users',
      dataImportMode: 'table',
      dataImportLaunchKey: 'launch-table-1',
      initialTab: 'target',
    });
  });

  it('keeps optional target values absent for a global entry', () => {
    const tab = buildDataImportWorkbenchTab({ title: 'Import data' });

    expect(tab.id).toBe(DATA_IMPORT_WORKBENCH_TAB_ID);
    expect(tab.connectionId).toBe('');
    expect(tab.dbName).toBeUndefined();
    expect(tab.tableName).toBeUndefined();
    expect(tab.dataImportMode).toBe('table');
    expect(tab.dataImportLaunchKey).toMatch(/^data-import-/);
  });

  it('builds a database import launch that clears a stale table target', () => {
    const tab = buildDataImportWorkbenchTab({
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'users',
      mode: 'database',
      launchKey: 'database-launch-1',
    });

    expect(tab).toMatchObject({
      connectionId: 'conn-1',
      dbName: 'app',
      dataImportMode: 'database',
      dataImportLaunchKey: 'database-launch-1',
    });
    expect(tab).toHaveProperty('tableName', undefined);
  });

  it('keeps the active target when the stable workbench is reopened during an import', () => {
    const existing = {
      ...buildDataImportWorkbenchTab({
        connectionId: 'conn-1',
        dbName: 'app',
        tableName: 'users',
        launchKey: 'running-launch',
      }),
      dataImportRunning: true,
    };

    expect(resolveDataImportWorkbenchLaunchTab(existing, {
      connectionId: 'conn-2',
      dbName: 'analytics',
      tableName: 'events',
      mode: 'database',
      launchKey: 'ignored-launch',
    })).toBe(existing);
  });
});
