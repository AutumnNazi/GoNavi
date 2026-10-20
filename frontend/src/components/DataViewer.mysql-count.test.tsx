import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import { resetTableMetadataRequestCacheForTests } from '../utils/tableMetadataRequestCache';
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
  DBQueryApplicationWithCancel: vi.fn(),
  DBQueryWithCancel: vi.fn(),
  CancelQuery: vi.fn(),
  DBGetColumns: vi.fn(),
  DBGetIndexes: vi.fn(),
}));

const messageApi = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

const modalApi = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

const dataGridState = vi.hoisted(() => ({
  latestProps: null as any,
  renderedProps: [] as any[],
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

vi.mock('./common/ResizableDraggableModal', () => ({
  default: {
    confirm: modalApi.confirm,
  },
}));

vi.mock('./DataGrid', () => ({
  default: (props: any) => {
    dataGridState.latestProps = props;
    dataGridState.renderedProps.push(props);
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

const createRows = (count: number) => Array.from({ length: count }, (_, i) => ({ ID: i + 1 }));
let tabID = 0;
const renderViewer = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DataViewer tab={createTab({ id: `mysql-count-${++tabID}` })} />); });
  await flushPromises();
  return renderer;
};
const props = () => dataGridState.latestProps;
const estimateCalls = () => backendApp.DBQuery.mock.calls.filter(call => String(call[2]).includes('information_schema.tables'));

describe('MySQL browsing totals', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetTableMetadataRequestCacheForTests();
    storeState.connections[0].config.type = 'mysql';
    backendApp.DBQueryApplicationWithCancel.mockImplementation((config, dbName, sql) => backendApp.DBQuery(config, dbName, sql));
    backendApp.CancelQuery.mockResolvedValue({ success: true });
    backendApp.DBGetColumns.mockResolvedValue({ success: true, data: [{ name: 'ID', key: 'PRI' }] });
    backendApp.DBGetIndexes.mockResolvedValue({ success: true, data: [] });
    backendApp.DBQuery.mockImplementation(async (_config, _db, sql: string) => ({ success: true,
      data: sql.includes('information_schema.tables') ? [{ approx_total: 500 }] : createRows(101), fields: ['ID'] }));
    backendApp.DBQueryWithCancel.mockResolvedValue({ success: true, data: [{ total: 450 }] });
  });

  it('uses estimates, not automatic COUNT, and never uses them as an exact last page', async () => {
    const renderer = await renderViewer();
    expect(props().pagination).toMatchObject({ totalKnown: false, totalApprox: true, approximateTotal: 500 });
    expect(backendApp.DBQuery.mock.calls.some(call => /COUNT\(/i.test(call[2]))).toBe(false);
    await act(async () => { await props().onPageChange(8, 100); });
    expect(props().pagination.current).toBe(8);
    expect(backendApp.DBQueryWithCancel).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it.each([null, -1, 'bad', undefined])('leaves invalid metadata %s unknown', async value => {
    backendApp.DBQuery.mockImplementation(async (_config, _db, sql: string) => ({ success: true,
      data: sql.includes('information_schema.tables') ? [{ approx_total: value }] : createRows(101) }));
    const renderer = await renderViewer();
    expect(props().pagination).toMatchObject({ totalKnown: false, totalApprox: false });
    renderer.unmount();
  });

  it('tolerates metadata failure and does not estimate filtered rows', async () => {
    backendApp.DBQuery.mockImplementation(async (_config, _db, sql: string) => {
      if (sql.includes('information_schema.tables')) throw new Error('denied');
      return { success: true, data: createRows(101) };
    });
    const renderer = await renderViewer();
    expect(props().pagination.totalKnown).toBe(false);
    expect(messageApi.error).not.toHaveBeenCalled();
    const calls = estimateCalls().length;
    await act(async () => { props().onApplyQuickWhereCondition('ID > 2'); });
    await flushPromises();
    expect(estimateCalls()).toHaveLength(calls);
    expect(props().pagination).toMatchObject({ totalKnown: false, totalApprox: false });
    renderer.unmount();
  });

  it('counts precisely on demand using a query ID and preserves connection timeout', async () => {
    const renderer = await renderViewer();
    await act(async () => { await props().onRequestTotalCount(); });
    expect(backendApp.DBQueryWithCancel).toHaveBeenCalledWith(expect.objectContaining({ queryTimeout: 120 }),
      'MYCIMLED', expect.stringMatching(/COUNT\(\*\)/), expect.stringMatching(/^viewer-count-/));
    expect(props().pagination).toMatchObject({ total: 450, totalKnown: true, totalApprox: false });
    await act(async () => { await props().onPageChange(2, 100); });
    expect(props().pagination).toMatchObject({ total: 450, totalKnown: true });
    renderer.unmount();
  });

  it.each(['cancel', 'refresh', 'filter', 'unmount'])('cancels backend and ignores late count on %s', async action => {
    let resolve!: (value: unknown) => void;
    backendApp.DBQueryWithCancel.mockImplementation(() => new Promise(done => { resolve = done; }));
    const renderer = await renderViewer();
    let pending!: Promise<unknown>;
    act(() => { pending = props().onRequestTotalCount(); });
    const id = backendApp.DBQueryWithCancel.mock.calls[0][3];
    await act(async () => {
      if (action === 'cancel') props().onCancelTotalCount();
      if (action === 'refresh') await props().onReload();
      if (action === 'filter') props().onApplyQuickWhereCondition('ID > 2');
      if (action === 'unmount') renderer.unmount();
    });
    expect(backendApp.CancelQuery).toHaveBeenCalledWith(id);
    await act(async () => { resolve({ success: true, data: [{ total: 999 }] }); await pending; });
    expect(props().pagination.total).not.toBe(999);
    if (action === 'refresh') expect(estimateCalls()).toHaveLength(2);
    if (action === 'cancel') expect(props().pagination.totalCountCancelled).toBe(true);
    if (action !== 'unmount') renderer.unmount();
  });

  it('ignores an old estimate after refresh and after a manual exact result', async () => {
    const pending: Array<(value: unknown) => void> = [];
    backendApp.DBQuery.mockImplementation(async (_config, _db, sql: string) => {
      if (sql.includes('information_schema.tables')) return new Promise(resolve => { pending.push(resolve); });
      return { success: true, data: createRows(101) };
    });
    const renderer = await renderViewer();
    await act(async () => { await props().onReload(); });
    await act(async () => { pending[0]({ success: true, data: [{ approx_total: 900 }] }); });
    expect(props().pagination.totalApprox).toBe(false);
    await act(async () => { await props().onRequestTotalCount(); });
    await act(async () => { pending[1]({ success: true, data: [{ approx_total: 800 }] }); });
    expect(props().pagination).toMatchObject({ totalKnown: true, total: 450, totalApprox: false });
    renderer.unmount();
  });

  it('does not claim an exact total from an empty out-of-range page', async () => {
    const renderer = await renderViewer();
    backendApp.DBQuery.mockResolvedValue({ success: true, data: [] });
    await act(async () => { await props().onPageChange(20, 100); });
    expect(props().pagination).toMatchObject({ current: 20, totalKnown: false });
    renderer.unmount();
  });

  it('retains the estimate on exact failure and retries successfully', async () => {
    const renderer = await renderViewer();
    backendApp.DBQueryWithCancel.mockResolvedValueOnce({ success: false, message: 'timeout' });
    await act(async () => { await props().onRequestTotalCount(); });
    expect(props().pagination).toMatchObject({ totalKnown: false, totalApprox: true, totalCountLoading: false });
    await act(async () => { await props().onRequestTotalCount(); });
    expect(props().pagination.total).toBe(450);
    renderer.unmount();
  });

  it('uses cancellable exact count for last-page navigation', async () => {
    const renderer = await renderViewer();
    await act(async () => { props().onLastPage(100); });
    await flushPromises();
    expect(backendApp.DBQueryWithCancel).toHaveBeenCalledTimes(1);
    expect(props().pagination.current).toBe(5);
    renderer.unmount();
  });
});
