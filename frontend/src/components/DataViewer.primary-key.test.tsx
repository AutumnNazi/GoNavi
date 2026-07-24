import React from 'react';
import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import { DUCKDB_ROWID_LOCATOR_COLUMN, ORACLE_ROWID_LOCATOR_COLUMN } from '../utils/rowLocator';
import DataViewer from './DataViewer';

const storeState = vi.hoisted(() => ({
  connections: [
    {
      id: 'conn-1',
      name: 'oracle',
      config: {
        type: 'oracle',
        host: '127.0.0.1',
        port: 1521,
        user: 'scott',
        password: '',
        database: 'ORCLPDB1',
      },
    },
  ],
  languagePreference: 'zh-CN',
  addSqlLog: vi.fn(),
}));

const backendApp = vi.hoisted(() => ({
  DBQuery: vi.fn(),
  DBGetColumns: vi.fn(),
  DBGetIndexes: vi.fn(),
}));

const messageApi = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

const dataGridState = vi.hoisted(() => ({
  latestProps: null as any,
}));

vi.mock('../store', () => {
  const useStore = Object.assign(
    (selector: (state: typeof storeState) => any) => selector(storeState),
    { getState: () => storeState },
  );
  return { useStore };
});

vi.mock('../../wailsjs/go/app/App', () => backendApp);

vi.mock('antd', () => ({
  message: messageApi,
}));

vi.mock('./DataGrid', () => ({
  default: (props: any) => {
    dataGridState.latestProps = props;
    return <div data-grid="true" />;
  },
  GONAVI_ROW_KEY: '__gonavi_row_key__',
}));

const createTab = (overrides: Partial<TabData> = {}): TabData => ({
  id: 'tab-1',
  title: 'EDC_LOG',
  type: 'table',
  connectionId: 'conn-1',
  dbName: 'MYCIMLED',
  tableName: 'EDC_LOG',
  ...overrides,
});

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const createRows = (count: number) => Array.from({ length: count }, (_, i) => ({
  ID: i + 1,
  NAME: `row-${i + 1}`,
}));

describe('DataViewer safe editing locator', () => {
  it('memoizes the table data viewer so parent-only modal state does not repaint loaded data', () => {
    const source = readFileSync(new URL('./DataViewer.tsx', import.meta.url), 'utf8');

    expect(source).toContain('React.memo(({ tab, isActive = true }) => {');
  });

  const renderAndReload = async (tab: TabData = createTab()) => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DataViewer tab={tab} />);
    });

    await act(async () => {
      await dataGridState.latestProps.onReload();
    });
    await flushPromises();
    return renderer!;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dataGridState.latestProps = null;
    storeState.connections = [
      {
        id: 'conn-1',
        name: 'oracle',
        config: {
          type: 'oracle',
          host: '127.0.0.1',
          port: 1521,
          user: 'scott',
          password: '',
          database: 'ORCLPDB1',
        },
      },
    ];
    storeState.languagePreference = 'zh-CN';
    storeState.connections[0].config.type = 'oracle';
    storeState.connections[0].config.database = 'ORCLPDB1';
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['ID', 'NAME'],
      data: [{ ID: 7, NAME: 'old-name' }],
    });
    backendApp.DBGetIndexes.mockResolvedValue({ success: true, data: [] });
  });

  it('localizes the missing connection message through DataViewer catalog keys', async () => {
    storeState.connections = [];

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DataViewer tab={createTab({ connectionId: 'missing-conn' })} />);
      await Promise.resolve();
    });
    await flushPromises();

    expect(messageApi.error).toHaveBeenCalledWith('未找到连接');
    renderer!.unmount();
  });

  it('defers the initial table query when the table opens in embedded object design', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: 'PRI' }, { name: 'NAME', key: '' }],
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DataViewer tab={createTab({ initialViewMode: 'fields', initialViewModeRequestId: 'open-design-1' })} />);
    });
    await flushPromises();

    expect(backendApp.DBQuery).not.toHaveBeenCalled();

    await act(async () => {
      dataGridState.latestProps?.onDataViewActivate?.();
    });
    await flushPromises();

    expect(backendApp.DBQuery).toHaveBeenCalled();
    renderer!.unmount();
  });

  it('keeps DataViewer message wrappers and SQL log phase labels keyed', () => {
    const source = readFileSync(new URL('./DataViewer.tsx', import.meta.url), 'utf8');

    expect(source).not.toMatch(/当前结果集尚未就绪|统计失败|统计总数失败|统计结果解析失败|Mongo 筛选条件无效|解析失败|主查询|复杂类型降级重试|重试\(32MB sort_buffer\)|重试\(128MB sort_buffer\)|已自动提升排序缓冲并重试成功|查询失败|查询超过连接超时时间|DuckDB 查询超过连接超时时间|超时|MongoDB 结果集中缺少 _id|加载索引失败|无法加载主键\/唯一索引元数据|无法加载唯一索引元数据|保持只读|当前结果没有可用的安全行定位方式/);
    expect(source).toContain('data_viewer.message.connection_not_found');
    expect(source).toContain('data_viewer.message.result_not_ready');
    expect(source).toContain('data_viewer.message.query_failed');
    expect(source).toContain('data_viewer.message.query_timeout');
    expect(source).toContain('data_viewer.message.duckdb_query_timeout');
    expect(source).toContain('data_viewer.read_only.reason.mongo_id_missing');
    expect(source).toContain('data_viewer.read_only.reason.no_safe_locator');
    expect(source).toContain('data_viewer.read_only.warning.table');
    expect(source).toContain('data_viewer.read_only.warning.collection');
    expect(source).toContain('data_viewer.sql_log.phase.main_query');
    expect(source).toContain('data_viewer.sql_log.phase.sort_buffer_retry');
  });

  it('caps viewer filter snapshots so long-running sessions do not retain unbounded table state', () => {
    const source = readFileSync(new URL('./DataViewer.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const MAX_VIEWER_FILTER_SNAPSHOTS = 64;');
    expect(source).toContain('const trimViewerFilterSnapshots = () => {');
    expect(source).toContain('setViewerFilterSnapshot(normalizedTabId, {');
  });

  it('enables table preview editing after primary keys are loaded', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ Name: 'ID', Key: 'PRI' }, { Name: 'NAME', Key: '' }],
    });

    const renderer = await renderAndReload();

    expect(dataGridState.latestProps?.pkColumns).toEqual(['ID']);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'primary-key',
      columns: ['ID'],
      valueColumns: ['ID'],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('enables table preview editing when primary key metadata uses boolean aliases', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ column_name: 'ID', isPrimary: true }, { column_name: 'NAME' }],
    });

    const renderer = await renderAndReload();

    expect(dataGridState.latestProps?.pkColumns).toEqual(['ID']);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'primary-key',
      columns: ['ID'],
      valueColumns: ['ID'],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('uses a unique index when the table has no primary key', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'EMAIL', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBGetIndexes.mockResolvedValue({
      success: true,
      data: [{ name: 'UK_EMAIL', columnName: 'EMAIL', nonUnique: 0, seqInIndex: 1, indexType: 'BTREE' }],
    });

    const renderer = await renderAndReload();

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'unique-key',
      columns: ['EMAIL'],
      valueColumns: ['EMAIL'],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps DuckDB table preview writable when unique index metadata arrives as a safe locator', async () => {
    storeState.connections[0].config.type = 'duckdb';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'slug', key: '' }, { name: 'name', key: '' }],
    });
    backendApp.DBGetIndexes.mockResolvedValue({
      success: true,
      data: [{ name: 'events_slug_key', columnName: 'slug', nonUnique: 0, seqInIndex: 1, indexType: 'UNIQUE' }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-duckdb-unique', dbName: 'main', tableName: 'main.events', title: 'events' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'unique-key',
      columns: ['slug'],
      valueColumns: ['slug'],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('uses hidden DuckDB rowid when no primary or unique key is available', async () => {
    storeState.connections[0].config.type = 'duckdb';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'name', key: '' }],
    });
    backendApp.DBGetIndexes.mockResolvedValue({
      success: true,
      data: [],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['name', DUCKDB_ROWID_LOCATOR_COLUMN],
      data: [{ name: 'launch', [DUCKDB_ROWID_LOCATOR_COLUMN]: 17 }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-duckdb-rowid', dbName: 'main', tableName: 'main.events', title: 'events' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'duckdb-rowid',
      columns: ['rowid'],
      valueColumns: [DUCKDB_ROWID_LOCATOR_COLUMN],
      hiddenColumns: [DUCKDB_ROWID_LOCATOR_COLUMN],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    expect(backendApp.DBQuery.mock.calls.some((call: any[]) => String(call[2]).includes(`rowid AS "${DUCKDB_ROWID_LOCATOR_COLUMN}"`))).toBe(true);
    renderer.unmount();
  });

  it('enables MongoDB table preview editing through the _id locator', async () => {
    storeState.connections[0].config.type = 'mongodb';
    storeState.connections[0].config.database = 'app';
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['_id', '__gonavi_mongodb_id_locator__', 'name', 'age'],
      data: [{
        _id: '507f1f77bcf86cd799439011',
        __gonavi_mongodb_id_locator__: { $oid: '507f1f77bcf86cd799439011' },
        name: 'old-name',
        age: 18,
      }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-mongo', dbName: 'app', tableName: 'users', title: 'users' }));

    expect(backendApp.DBGetColumns).not.toHaveBeenCalled();
    expect(backendApp.DBGetIndexes).not.toHaveBeenCalled();
    expect(dataGridState.latestProps?.pkColumns).toEqual(['_id']);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'primary-key',
      columns: ['_id'],
      valueColumns: ['__gonavi_mongodb_id_locator__'],
      hiddenColumns: ['__gonavi_mongodb_id_locator__'],
      writableColumns: {
        name: 'name',
        age: 'age',
      },
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    const mongoFindCall = backendApp.DBQuery.mock.calls.find((call: any[]) => String(call[2] || '').includes('"find":"users"'));
    expect(mongoFindCall).toBeTruthy();
    expect(JSON.parse(String(mongoFindCall?.[2] || '{}'))).toMatchObject({
      find: 'users',
      sort: { _id: 1 },
      __gonaviIncludeObjectIDLocator: true,
    });
    renderer.unmount();
  });

  it('keeps MongoDB results read-only when _id is missing', async () => {
    storeState.languagePreference = 'en-US';
    storeState.connections[0].config.type = 'mongodb';
    storeState.connections[0].config.database = 'app';
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['name'],
      data: [{ name: 'orphan-doc' }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-mongo-no-id', dbName: 'app', tableName: 'users', title: 'users' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'none',
      readOnly: true,
      reason: 'MongoDB result set is missing _id, so changes cannot be submitted safely.',
    });
    expect(dataGridState.latestProps?.readOnly).toBe(true);
    expect(messageApi.warning).toHaveBeenCalledWith('Collection app.users remains read-only: MongoDB result set is missing _id, so changes cannot be submitted safely.');
    renderer.unmount();
  });

  it('uses hidden Oracle ROWID when no primary or unique key is available', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['ID', 'NAME', ORACLE_ROWID_LOCATOR_COLUMN],
      data: [{ ID: 7, NAME: 'old-name', [ORACLE_ROWID_LOCATOR_COLUMN]: 'AAAA' }],
    });

    const renderer = await renderAndReload();

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'oracle-rowid',
      columns: ['ROWID'],
      valueColumns: [ORACLE_ROWID_LOCATOR_COLUMN],
      hiddenColumns: [ORACLE_ROWID_LOCATOR_COLUMN],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    expect(backendApp.DBQuery.mock.calls.some((call: any[]) => String(call[2]).includes(`ROWID AS "${ORACLE_ROWID_LOCATOR_COLUMN}"`))).toBe(true);
    renderer.unmount();
  });

  it('uses hidden OceanBase Oracle ROWID when no primary or unique key is available', async () => {
    storeState.connections[0].config.type = 'oceanbase';
    (storeState.connections[0].config as any).oceanBaseProtocol = 'oracle';
    storeState.connections[0].config.user = 'dev';
    storeState.connections[0].config.database = 'ORCLPDB1';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['ID', 'NAME', ORACLE_ROWID_LOCATOR_COLUMN],
      data: [{ ID: 7, NAME: 'old-name', [ORACLE_ROWID_LOCATOR_COLUMN]: 'AAAA' }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-ob-oracle-rowid', dbName: 'ORCLPDB1', tableName: 'EDC_LOG', title: 'EDC_LOG' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'oracle-rowid',
      columns: ['ROWID'],
      valueColumns: [ORACLE_ROWID_LOCATOR_COLUMN],
      hiddenColumns: [ORACLE_ROWID_LOCATOR_COLUMN],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    // 行号改由 appearance.showDataTableRowNumber 控制，不再按数据源硬编码传入
    expect(dataGridState.latestProps?.showRowNumberColumn).toBeUndefined();
    expect(messageApi.warning).not.toHaveBeenCalled();
    expect(backendApp.DBQuery.mock.calls.some((call: any[]) => String(call[2]).includes(`ROWID AS "${ORACLE_ROWID_LOCATOR_COLUMN}"`))).toBe(true);
    renderer.unmount();
  });

  it('queries Oracle views without injecting ROWID and keeps the result read-only', async () => {
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['ID', 'NAME'],
      data: [{ ID: 7, NAME: 'view-row' }],
    });

    const renderer = await renderAndReload(createTab({
      id: 'tab-oracle-view-rowid',
      tableName: 'PERSON_VIEW',
      title: 'PERSON_VIEW',
      objectType: 'view',
    }));

    const viewQueries = backendApp.DBQuery.mock.calls
      .map((call: any[]) => String(call[2] || ''))
      .filter((sql: string) => sql.includes('PERSON_VIEW'));
    expect(viewQueries.length).toBeGreaterThan(0);
    expect(viewQueries.every((sql: string) => !/\bROWID\b/i.test(sql))).toBe(true);
    expect(dataGridState.latestProps?.readOnly).toBe(true);
    renderer.unmount();
  });

  it('does not add fallback ORDER BY for DuckDB table preview when a primary key is available', async () => {
    storeState.connections[0].config.type = 'duckdb';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: 'PRI' }, { name: 'NAME', key: '' }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-duckdb-order', dbName: 'main', tableName: 'events', title: 'events' }));

    const tableQueries = backendApp.DBQuery.mock.calls
      .map((call: any[]) => String(call[2] || ''))
      .filter((sql: string) => sql.includes('FROM "events"'));
    expect(tableQueries.length).toBeGreaterThan(0);
    expect(tableQueries.every((sql: string) => !/\border\s+by\b/i.test(sql))).toBe(true);
    expect(tableQueries[tableQueries.length - 1]).toContain('LIMIT 101 OFFSET 0');
    renderer.unmount();
  });

  it('requeries table preview when a column header filter is applied', async () => {
    storeState.connections[0].config.type = 'mysql';
    storeState.connections[0].config.database = 'missav_bot';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'id', key: 'PRI' }, { name: 'code', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: true,
      fields: ['id', 'code'],
      data: [{ id: 2, code: 'EROFV-3551' }],
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DataViewer tab={createTab({ dbName: 'missav_bot', tableName: 'videos', title: 'videos' })} />);
    });
    await flushPromises();

    backendApp.DBQuery.mockClear();
    await act(async () => {
      dataGridState.latestProps?.onApplyFilter([{
        id: 1,
        enabled: true,
        logic: 'AND',
        column: 'code',
        op: 'CONTAINS',
        value: '3551',
        value2: '',
      }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPromises();

    const filteredSelectSql = backendApp.DBQuery.mock.calls
      .map((call: any[]) => String(call[2] || ''))
      .find((sql: string) => /select\s+\*\s+from\s+`videos`/i.test(sql) && /where/i.test(sql));
    expect(filteredSelectSql).toContain("`code` LIKE '%3551%'");
    renderer!.unmount();
  });

  it('keeps DuckDB table preview writable when primary key metadata arrives for a qualified table name', async () => {
    storeState.connections[0].config.type = 'duckdb';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'id', key: 'PRI' }, { name: 'name', key: '' }],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-duckdb-pri', dbName: 'main', tableName: 'main.events', title: 'events' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual(['id']);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'primary-key',
      columns: ['id'],
      valueColumns: ['id'],
      readOnly: false,
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.warning).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('invalidates a stale known total when table data grows after a manual refresh', async () => {
    storeState.connections[0].config.type = 'mysql';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: 'PRI' }, { name: 'NAME', key: '' }],
    });

    let pageQueryCount = 0;
    backendApp.DBQuery.mockImplementation(async (_config: any, _dbName: string, sql: string) => {
      if (/count\s*\(/i.test(String(sql))) {
        return {
          success: true,
          fields: ['total'],
          data: [{ total: 500 }],
        };
      }
      pageQueryCount += 1;
      return {
        success: true,
        fields: ['ID', 'NAME'],
        data: pageQueryCount === 1 ? createRows(100) : createRows(101),
      };
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DataViewer tab={createTab({ dbName: 'main', tableName: 'users', title: 'users' })} />);
    });
    await flushPromises();

    expect(dataGridState.latestProps?.pagination).toMatchObject({
      total: 100,
      totalKnown: true,
    });

    await act(async () => {
      dataGridState.latestProps?.onReload();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPromises();

    expect(backendApp.DBQuery.mock.calls.some((call: any[]) => /count\s*\(/i.test(String(call[2] || '')))).toBe(true);
    expect(dataGridState.latestProps?.pagination).toMatchObject({
      total: 500,
      totalKnown: true,
    });
    expect(dataGridState.latestProps?.data).toHaveLength(100);
    renderer!.unmount();
  });

  it('shows an actionable message for DuckDB timeout interruption errors', async () => {
    storeState.languagePreference = 'en-US';
    storeState.connections[0].config.type = 'duckdb';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: false,
      message: 'context deadline exceeded INTERRUPT Error: Interrupted!',
      fields: [],
      data: [],
    });

    const renderer = await renderAndReload(createTab({ id: 'tab-duckdb-timeout', dbName: 'main', tableName: 'events', title: 'events' }));

    expect(messageApi.error).toHaveBeenCalledWith('DuckDB query exceeded the connection timeout and was interrupted. Increase the connection timeout, or reduce the sort/filter scope and retry.');
    expect(storeState.addSqlLog.mock.calls.some((call: any[]) => String(call[0]?.message || '').includes('context deadline exceeded'))).toBe(true);
    renderer.unmount();
  });

  it.each([
    [
      'zh-TW',
      '資料庫連線逾時：mysql 127.0.0.1:3306/crm：網路逾時',
      '查詢超過連線逾時時間，已中斷。請調高連線逾時時間，或縮小查詢範圍後再試。',
    ],
    [
      'ja-JP',
      'データベース接続がタイムアウトしました: mysql 127.0.0.1:3306/crm: ネットワークタイムアウト',
      'クエリが接続タイムアウトを超えたため中断されました。接続タイムアウトを延長するか、クエリ範囲を絞って再試行してください。',
    ],
    [
      'de-DE',
      'Zeitüberschreitung bei der Datenbankverbindung: mysql 127.0.0.1:3306/crm: Netzwerk-Timeout',
      'Die Abfrage hat das Verbindungstimeout überschritten und wurde unterbrochen. Erhöhen Sie das Verbindungstimeout oder verkleinern Sie den Abfragebereich und versuchen Sie es erneut.',
    ],
    [
      'ru-RU',
      'Тайм-аут подключения к базе данных: mysql 127.0.0.1:3306/crm: тайм-аут сети',
      'Запрос превысил тайм-аут подключения и был прерван. Увеличьте тайм-аут подключения или сократите область запроса и повторите попытку.',
    ],
  ])('maps localized connection-timeout wrappers to viewer timeout copy for %s', async (locale, backendMessage, expectedMessage) => {
    storeState.languagePreference = locale;
    storeState.connections[0].config.type = 'mysql';
    storeState.connections[0].config.database = 'crm';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });
    backendApp.DBQuery.mockResolvedValue({
      success: false,
      message: backendMessage,
      fields: [],
      data: [],
    });

    const renderer = await renderAndReload(createTab({ id: `tab-timeout-${locale}`, dbName: 'crm', tableName: 'orders', title: 'orders' }));

    expect(messageApi.error).toHaveBeenCalledWith(expectedMessage);
    expect(storeState.addSqlLog.mock.calls.some((call: any[]) => String(call[0]?.message || '').includes(backendMessage))).toBe(true);
    renderer.unmount();
  });

  it('falls back to all-columns editing when no safe locator exists', async () => {
    storeState.languagePreference = 'en-US';
    storeState.connections[0].config.type = 'mysql';
    storeState.connections[0].config.database = 'main';
    backendApp.DBGetColumns.mockResolvedValue({
      success: true,
      data: [{ name: 'ID', key: '' }, { name: 'NAME', key: '' }],
    });

    const renderer = await renderAndReload(createTab({ dbName: 'main', tableName: 'users', title: 'users' }));

    expect(dataGridState.latestProps?.pkColumns).toEqual([]);
    expect(dataGridState.latestProps?.editLocator).toMatchObject({
      strategy: 'all-columns',
      columns: ['ID', 'NAME'],
      readOnly: false,
      reason: 'No primary key or unique index was detected, so rows will be located by matching all columns. Edit with care.',
    });
    expect(dataGridState.latestProps?.readOnly).toBe(false);
    expect(messageApi.info).toHaveBeenCalledWith('No primary key or unique index was detected, so rows will be located by matching all columns. Edit with care.');
    renderer.unmount();
  });
});
