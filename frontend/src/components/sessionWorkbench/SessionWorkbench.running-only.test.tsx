import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  workbench: null as any,
  toolbarProps: null as any,
  tableProps: null as any,
}));

vi.mock('../../i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('antd', () => ({
  Alert: () => <div />,
  Empty: () => <div />,
  Spin: () => <div />,
  message: { useMessage: () => [{}, null] },
}));

vi.mock('./useSessionWorkbench', () => ({
  useSessionWorkbench: () => harness.workbench,
}));

vi.mock('./useSessionWorkbenchDialogs', () => ({
  useSessionWorkbenchDialogs: () => ({
    chooserRow: null,
    confirmRow: null,
    confirmAction: null,
    confirmLoading: false,
    handleRowAction: vi.fn(),
    selectAction: vi.fn(),
    closeChooser: vi.fn(),
    closeConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
  }),
}));

vi.mock('./SessionToolbar', () => ({
  default: (props: any) => {
    harness.toolbarProps = props;
    return null;
  },
}));

vi.mock('./SessionTable', () => ({
  default: (props: any) => {
    harness.tableProps = props;
    return null;
  },
}));

vi.mock('./SessionHeader', () => ({ default: () => null }));
vi.mock('./SessionSummary', () => ({ default: () => null }));
vi.mock('./SessionActionChooser', () => ({ default: () => null }));
vi.mock('./SessionConfirmModal', () => ({ default: () => null }));

import SessionWorkbench from './SessionWorkbench';

const sessions = [
  { key: 'running', sessionId: '1', state: 'Query', statement: 'SELECT SLEEP(30)' },
  { key: 'idle', sessionId: '2', state: 'Sleep', statement: '' },
];

const buildWorkbench = (runningOnly: boolean) => ({
  connections: [],
  selectedConnection: { id: 'c1', name: 'Local', config: { type: 'mysql' } },
  selectedConnectionId: 'c1',
  setSelectedConnectionId: vi.fn(),
  databaseName: '',
  selectDatabase: vi.fn(),
  filter: '',
  setFilter: vi.fn(),
  runningOnly,
  setRunningOnly: vi.fn(),
  databases: [],
  loadDatabases: vi.fn(),
  databasesLoading: false,
  payload: {
    engine: 'mysql',
    capability: { supported: true, canCancelQuery: true, canTerminateSession: true },
    sessions,
  },
  loading: false,
  error: '',
  scopeRevision: 0,
  refresh: vi.fn(),
  executeAction: vi.fn(),
});

const render = () => {
  act(() => {
    create(<SessionWorkbench tab={{ connectionId: 'c1', dbName: '' }} />);
  });
};

describe('SessionWorkbench running-only shortcut', () => {
  beforeEach(() => {
    harness.toolbarProps = null;
    harness.tableProps = null;
  });

  it('drives the shared workbench state from the toolbar checkbox', () => {
    harness.workbench = buildWorkbench(false);
    render();

    expect(harness.toolbarProps.runningOnly).toBe(false);
    harness.toolbarProps.onRunningOnlyChange(true);
    expect(harness.workbench.setRunningOnly).toHaveBeenCalledWith(true);
  });

  it('shows only executing sessions once the shortcut is on', () => {
    harness.workbench = buildWorkbench(true);
    render();

    expect(harness.toolbarProps.runningOnly).toBe(true);
    expect(harness.tableProps.sessions.map((session: { key: string }) => session.key)).toEqual(['running']);
  });
});
