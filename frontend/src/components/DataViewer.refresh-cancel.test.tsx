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

describe('Table refresh cancellation', () => {
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


  it('cancels the running query, preserves rows and ignores its late result after a new refresh', async () => {
    const renderer = await renderViewer();
    const originalData = props().data;
    let resolveOld!: (value: unknown) => void;
    backendApp.DBQueryApplicationWithCancel.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = props().onReload(); });
    expect(props().loading).toBe(true);
    const calls = backendApp.DBQueryApplicationWithCancel.mock.calls;
    const id = calls[calls.length - 1][3];
    act(() => props().onCancelReload());
    expect(backendApp.CancelQuery).toHaveBeenCalledWith(id);
    expect(props().loading).toBe(false);
    expect(props().data).toBe(originalData);
    await act(async () => { await props().onReload(); });
    const refreshedData = props().data;
    await act(async () => {
      resolveOld({ success: true, data: [{ ID: 9999 }], fields: ['ID'] });
      await pending;
    });
    expect(props().data).toBe(refreshedData);
    expect(props().loading).toBe(false);
    renderer.unmount();
  });

  it('ignores late errors and does not retry a cancelled refresh', async () => {
    const renderer = await renderViewer();
    let resolveOld!: (value: unknown) => void;
    backendApp.DBQueryApplicationWithCancel.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = props().onReload(); });
    act(() => props().onCancelReload());
    const calls = backendApp.DBQueryApplicationWithCancel.mock.calls.length;
    await act(async () => {
      resolveOld({ success: false, message: 'Error 1038 out of sort memory' });
      await pending;
    });
    expect(backendApp.DBQueryApplicationWithCancel).toHaveBeenCalledTimes(calls);
    expect(messageApi.error).not.toHaveBeenCalled();
    expect(props().loading).toBe(false);
    renderer.unmount();
  });
  it('stops while metadata is pending without starting the data query afterward', async () => {
    let resolveColumns!: (value: unknown) => void;
    backendApp.DBGetColumns.mockImplementationOnce(() => new Promise(resolve => { resolveColumns = resolve; }));
    const renderer = await renderViewer();
    expect(props().loading).toBe(true);
    act(() => props().onCancelReload());
    expect(props().loading).toBe(false);
    await act(async () => {
      resolveColumns({ success: true, data: [{ name: 'ID', key: 'PRI' }] });
      await Promise.resolve();
    });
    expect(backendApp.DBQueryApplicationWithCancel).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps the newer refresh loading when a cancelled request finishes', async () => {
    const renderer = await renderViewer();
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    backendApp.DBQueryApplicationWithCancel
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;
    await act(async () => { oldRequest = props().onReload(); });
    act(() => props().onCancelReload());
    await act(async () => { newRequest = props().onReload(); });
    await act(async () => {
      resolveOld({ success: true, data: [{ ID: 9999 }], fields: ['ID'] });
      await oldRequest;
    });
    expect(props().loading).toBe(true);
    await act(async () => {
      resolveNew({ success: true, data: [{ ID: 42 }], fields: ['ID'] });
      await newRequest;
    });
    expect(props().loading).toBe(false);
    expect(props().data[0].ID).toBe(42);
    renderer.unmount();
  });

});
