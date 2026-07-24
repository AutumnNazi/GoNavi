import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DataImportWorkbench from './DataImportWorkbench';

const mocks = vi.hoisted(() => ({
  dbGetDatabases: vi.fn(),
  dbGetTables: vi.fn(),
  importData: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  addTab: vi.fn(),
  storeState: {
    theme: 'light',
    connections: [] as any[],
    addTab: (...args: any[]) => mocks.addTab(...args),
  },
}));

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState),
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  DBGetDatabases: mocks.dbGetDatabases,
  DBGetTables: mocks.dbGetTables,
  ImportData: mocks.importData,
}));

vi.mock('./ImportPreviewModal', () => ({
  default: (props: Record<string, unknown>) => React.createElement(
    'mock-import-preview',
    { 'data-import-preview-mock': 'true', ...props },
  ),
}));

vi.mock('antd', async () => {
  const React = await import('react');
  const Select = (props: Record<string, unknown>) => React.createElement('mock-select', props);
  const Button = ({ children, ...props }: any) => <button {...props}>{children}</button>;
  const Alert = (props: Record<string, unknown>) => React.createElement('mock-alert', props);
  const Empty = ({ description, ...props }: any) => React.createElement('mock-empty', props, description);
  Empty.PRESENTED_IMAGE_SIMPLE = 'simple';
  const Text = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const Title = ({ children, ...props }: any) => <h2 {...props}>{children}</h2>;
  return {
    Alert,
    Button,
    Empty,
    Select,
    Typography: { Text, Title },
    message: {
      error: mocks.messageError,
      success: mocks.messageSuccess,
    },
  };
});

vi.mock('@ant-design/icons', () => ({
  FileAddOutlined: () => React.createElement('mock-icon', { 'data-icon': 'file-add' }),
  ImportOutlined: () => React.createElement('mock-icon', { 'data-icon': 'import' }),
}));

const createTab = (overrides: Record<string, unknown> = {}) => ({
  id: 'data-import-workbench',
  title: 'Data import',
  type: 'data-import',
  connectionId: 'conn-1',
  dbName: 'app',
  tableName: 'users',
  ...overrides,
} as any);

const renderWorkbench = async (overrides: Record<string, unknown> = {}) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<DataImportWorkbench tab={createTab(overrides)} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
};

describe('DataImportWorkbench', () => {
  beforeEach(() => {
    mocks.storeState.theme = 'light';
    mocks.storeState.connections = [
      {
        id: 'conn-1',
        name: 'Primary MySQL',
        config: {
          type: 'mysql',
          host: 'localhost',
          port: 3306,
          user: 'root',
          database: 'app',
        },
        includeDatabases: ['app'],
      },
      {
        id: 'redis-1',
        name: 'Redis',
        config: { type: 'redis', host: 'localhost', port: 6379 },
      },
      {
        id: 'mongo-1',
        name: 'MongoDB',
        config: { type: 'mongodb', host: 'localhost', port: 27017 },
      },
      {
        id: 'protected-1',
        name: 'Protected PostgreSQL',
        config: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          protection: { restrictDataImport: true },
        },
      },
    ];
    mocks.dbGetDatabases.mockReset();
    mocks.dbGetDatabases.mockResolvedValue({
      success: true,
      data: [{ Database: 'app' }, { Database: 'hidden' }],
    });
    mocks.dbGetTables.mockReset();
    mocks.dbGetTables.mockResolvedValue({
      success: true,
      data: [{ Tables_in_app: 'users' }, { Tables_in_app: 'orders' }],
    });
    mocks.importData.mockReset();
    mocks.importData.mockResolvedValue({
      success: true,
      data: { filePath: '/tmp/users.csv' },
    });
    mocks.messageError.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.addTab.mockReset();
  });

  it('filters non-relational and protected connections while loading the prefilled target', async () => {
    const renderer = await renderWorkbench();
    const connectionSelect = renderer.root.findByProps({
      'data-import-target-field': 'connection',
    });
    const databaseSelect = renderer.root.findByProps({
      'data-import-target-field': 'database',
    });
    const tableSelect = renderer.root.findByProps({
      'data-import-target-field': 'table',
    });

    expect(connectionSelect.props.options.map((option: any) => option.value)).toEqual(['conn-1']);
    expect(databaseSelect.props.options.map((option: any) => option.value)).toEqual(['app']);
    expect(tableSelect.props.options.map((option: any) => option.value)).toEqual(['orders', 'users']);
    expect(mocks.dbGetDatabases).toHaveBeenCalledTimes(1);
    expect(mocks.dbGetTables).toHaveBeenCalledWith(expect.anything(), 'app');
  });

  it('syncs the automatic connection fallback back to the stable workbench tab', async () => {
    const renderer = await renderWorkbench({
      connectionId: '',
      dbName: undefined,
      tableName: undefined,
    });

    expect(renderer.root.findByProps({
      'data-import-target-field': 'connection',
    }).props.value).toBe('conn-1');
    expect(mocks.addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'data-import-workbench',
      connectionId: 'conn-1',
      dbName: undefined,
      tableName: undefined,
      dataImportRunning: false,
    }));
  });

  it('selects a file for the target and embeds the shared preview workflow', async () => {
    const renderer = await renderWorkbench();
    const selectFileButton = renderer.root.findByProps({
      'data-import-select-file-action': 'true',
    });

    await act(async () => {
      selectFileButton.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.importData).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mysql' }),
      'app',
      'users',
    );
    const preview = renderer.root.findByProps({ 'data-import-preview-mock': 'true' });
    expect(preview.props).toMatchObject({
      visible: true,
      presentation: 'embedded',
      filePath: '/tmp/users.csv',
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'users',
    });

    const connectionSelect = renderer.root.findByProps({
      'data-import-target-field': 'connection',
    });
    expect(connectionSelect.props.disabled).toBe(true);

    await act(async () => {
      preview.props.onImportingChange(true);
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({
      'data-import-select-file-action': 'true',
    }).props.disabled).toBe(true);
  });

  it('clears downstream target state when the database changes', async () => {
    const renderer = await renderWorkbench();
    const databaseSelect = renderer.root.findByProps({
      'data-import-target-field': 'database',
    });

    mocks.dbGetTables.mockResolvedValueOnce({
      success: true,
      data: [{ Tables_in_analytics: 'events' }],
    });
    await act(async () => {
      databaseSelect.props.onChange('analytics');
      await Promise.resolve();
      await Promise.resolve();
    });

    const tableSelect = renderer.root.findByProps({
      'data-import-target-field': 'table',
    });
    const selectFileButton = renderer.root.findByProps({
      'data-import-select-file-action': 'true',
    });
    expect(tableSelect.props.value).toBeUndefined();
    expect(selectFileButton.props.disabled).toBe(true);
    expect(mocks.dbGetTables).toHaveBeenLastCalledWith(expect.anything(), 'analytics');
    expect(mocks.addTab).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'data-import-workbench',
      connectionId: 'conn-1',
      dbName: 'analytics',
      tableName: undefined,
    }));
  });

  it('does not report the native file-picker cancellation as an error', async () => {
    mocks.importData.mockResolvedValueOnce({ success: false, message: '已取消' });
    const renderer = await renderWorkbench();
    const selectFileButton = renderer.root.findByProps({
      'data-import-select-file-action': 'true',
    });

    await act(async () => {
      selectFileButton.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.messageError).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ 'data-import-preview-mock': 'true' })).toHaveLength(0);
  });

  it('does not replace an active import target when the stable tab is reopened', async () => {
    const renderer = await renderWorkbench();
    const selectFileButton = renderer.root.findByProps({
      'data-import-select-file-action': 'true',
    });
    await act(async () => {
      selectFileButton.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    const preview = renderer.root.findByProps({ 'data-import-preview-mock': 'true' });
    await act(async () => {
      preview.props.onImportingChange(true);
      renderer.update(<DataImportWorkbench tab={createTab({ dbName: 'analytics', tableName: 'events' })} />);
      await Promise.resolve();
    });

    expect(mocks.addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'data-import-workbench',
      connectionId: 'conn-1',
      dbName: 'app',
      tableName: 'users',
      dataImportRunning: true,
    }));

    const activePreview = renderer.root.findByProps({ 'data-import-preview-mock': 'true' });
    expect(activePreview.props.dbName).toBe('app');
    expect(activePreview.props.tableName).toBe('users');
    expect(activePreview.props.filePath).toBe('/tmp/users.csv');
  });
});
