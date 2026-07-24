import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SQLFileExecutionState } from './useSQLFileExecutionRunner';
import DatabaseImportExecutionPanel from './DatabaseImportExecutionPanel';

const createRunnerState = (
  overrides: Partial<SQLFileExecutionState> = {},
): SQLFileExecutionState => ({
  jobId: '',
  title: '',
  filePath: '',
  fileSizeMB: '',
  startedAt: 0,
  finishedAt: 0,
  status: 'idle',
  stage: '',
  executed: 0,
  failed: 0,
  total: 0,
  percent: 0,
  currentSQL: '',
  message: '',
  ...overrides,
});

const mocks = vi.hoisted(() => ({
  importDatabaseSQL: vi.fn(),
  cancelSQLFileExecution: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  state: null as SQLFileExecutionState | null,
  isRunning: false,
  lastRunOptions: null as null | {
    run: (jobId: string) => Promise<any>;
    cancel?: (jobId: string) => void | Promise<void>;
  },
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  ImportDatabaseSQL: mocks.importDatabaseSQL,
  CancelSQLFileExecution: mocks.cancelSQLFileExecution,
}));

vi.mock('./useSQLFileExecutionRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useSQLFileExecutionRunner')>();
  return {
    ...actual,
    useSQLFileExecutionRunner: () => ({
      state: mocks.state,
      reset: mocks.reset,
      cancelExecution: mocks.cancel,
      runSQLFileExecutionWithProgress: mocks.run,
      isRunning: mocks.isRunning,
    }),
  };
});

vi.mock('antd', async () => {
  const React = await import('react');
  const Alert = (props: Record<string, unknown>) => React.createElement('mock-alert', props);
  const Button = ({ children, ...props }: any) => <button {...props}>{children}</button>;
  const Progress = (props: Record<string, unknown>) => React.createElement('mock-progress', props);
  const Paragraph = ({ children, ...props }: any) => <p {...props}>{children}</p>;
  const Text = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const Title = ({ children, ...props }: any) => <h3 {...props}>{children}</h3>;
  return {
    Alert,
    Button,
    Progress,
    Typography: { Paragraph, Text, Title },
  };
});

vi.mock('@ant-design/icons', () => ({
  PlayCircleOutlined: () => React.createElement('mock-icon', { name: 'play' }),
  ReloadOutlined: () => React.createElement('mock-icon', { name: 'reload' }),
  StopOutlined: () => React.createElement('mock-icon', { name: 'stop' }),
}));

const renderPanel = async (onRunningChange = vi.fn()) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <DatabaseImportExecutionPanel
        connectionConfig={{ type: 'mysql', host: 'localhost', port: 3306 }}
        dbName="app"
        filePath="/tmp/database.sql"
        fileSizeMB="12.5"
        darkMode={false}
        onRunningChange={onRunningChange}
      />,
    );
    await Promise.resolve();
  });
  return renderer;
};

describe('DatabaseImportExecutionPanel', () => {
  beforeEach(() => {
    mocks.state = createRunnerState();
    mocks.isRunning = false;
    mocks.lastRunOptions = null;
    mocks.importDatabaseSQL.mockReset();
    mocks.cancelSQLFileExecution.mockReset();
    mocks.reset.mockReset();
    mocks.run.mockReset();
    mocks.cancel.mockReset();
    mocks.run.mockImplementation(async (options: any) => {
      mocks.lastRunOptions = options;
      return options.run('database-import-job-1');
    });
    mocks.cancel.mockImplementation(async () => {
      await mocks.lastRunOptions?.cancel?.('database-import-job-1');
    });
  });

  it('waits for an explicit start action and reports the full RPC lifetime as running', async () => {
    let resolveImport!: (value: { success: boolean; message: string }) => void;
    mocks.importDatabaseSQL.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));
    const onRunningChange = vi.fn();
    const renderer = await renderPanel(onRunningChange);

    expect(mocks.importDatabaseSQL).not.toHaveBeenCalled();
    const startButton = renderer.root.findByProps({
      'data-database-import-start-action': 'true',
    });

    await act(async () => {
      startButton.props.onClick();
      await Promise.resolve();
    });

    expect(mocks.importDatabaseSQL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mysql' }),
      'app',
      '/tmp/database.sql',
      'database-import-job-1',
    );
    expect(onRunningChange).toHaveBeenLastCalledWith(true);
    expect(renderer.root.findAllByProps({
      'data-database-import-cancel-action': 'true',
    }).length).toBeGreaterThan(0);

    await act(async () => {
      resolveImport({ success: true, message: 'done' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRunningChange).toHaveBeenLastCalledWith(false);
  });

  it('cancels the active SQL import with the runner job id', async () => {
    let resolveImport!: (value: { success: boolean; message: string }) => void;
    mocks.importDatabaseSQL.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));
    mocks.cancelSQLFileExecution.mockResolvedValue({ success: true });
    const renderer = await renderPanel();

    await act(async () => {
      renderer.root.findByProps({
        'data-database-import-start-action': 'true',
      }).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({
        'data-database-import-cancel-action': 'true',
      }).props.onClick();
      await Promise.resolve();
    });

    expect(mocks.cancelSQLFileExecution).toHaveBeenCalledWith('database-import-job-1');

    await act(async () => {
      resolveImport({ success: false, message: 'cancelled' });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it.each([
    ['done', 'success', 'completed'],
    ['error', 'error', 'failed'],
    ['cancelled', 'warning', 'cancelled'],
  ] as const)('renders %s progress and result state', async (status, alertType, message) => {
    mocks.state = createRunnerState({
      jobId: 'database-import-job-1',
      status,
      stage: status,
      filePath: '/tmp/database.sql',
      executed: 24,
      failed: status === 'error' ? 1 : 0,
      total: 25,
      percent: status === 'done' ? 100 : 96,
      currentSQL: 'CREATE TABLE demo(id INT)',
      message,
    });
    const renderer = await renderPanel();

    expect(renderer.root.findByProps({
      'data-database-import-progress': 'true',
    }).props.percent).toBe(status === 'done' ? 100 : 96);
    expect(renderer.root.findByProps({
      'data-database-import-result': 'true',
    }).props).toMatchObject({
      type: alertType,
      message,
    });
    expect(renderer.root.findAllByProps({
      'data-database-import-current-sql': 'true',
    })).toHaveLength(1);
  });
});
