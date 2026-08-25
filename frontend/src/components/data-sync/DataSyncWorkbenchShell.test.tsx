import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modalConfirm = vi.hoisted(() => vi.fn());

vi.mock('../common/ResizableDraggableModal', () => ({
  default: { confirm: modalConfirm },
}));

import { createStaticDataSyncWorkbenchGateway } from './gateway';
import {
  createDataSyncTableMapping,
  createDataSyncTaskDraft,
  reviseDataSyncTask,
  type DataSyncErrorRow,
  type DataSyncRunRecord,
} from './model';
import {
  mergeDataSyncInitialTasks,
  DataSyncWorkbenchShell,
  resolveDataSyncSidebarRefreshes,
} from './DataSyncWorkbenchShell';

const buildTask = () => {
  const draft = createDataSyncTaskDraft({
    id: 'orders-task',
    kind: 'reconcile',
    name: '订单同步',
    now: '2026-08-08T00:00:00.000Z',
  });
  return reviseDataSyncTask(draft, {
    source: {
      connectionId: 'mysql-prod',
      connectionName: 'MySQL 生产库',
      type: 'mysql',
      database: 'sales',
      schema: '',
    },
    target: {
      connectionId: 'postgres-warehouse',
      connectionName: 'PostgreSQL 数仓',
      type: 'postgres',
      database: 'warehouse',
      schema: 'ods',
    },
    mappings: [
      {
        ...createDataSyncTableMapping('orders-map', 'orders', 'ods.orders'),
        keyColumns: ['id'],
      },
    ],
  });
};

const latestConfirmation = (): {
  title: string;
  content: string;
  okText: string;
  onOk: () => Promise<void>;
} => modalConfirm.mock.calls[modalConfirm.mock.calls.length - 1]![0];

describe('DataSyncWorkbenchShell', () => {
  afterEach(() => {
    modalConfirm.mockReset();
    vi.unstubAllGlobals();
  });

  it('requests one target database refresh when a run finishes after writing rows', () => {
    const task = buildTask();
    const completedRun: DataSyncRunRecord = {
      id: 'run-completed',
      taskId: task.id,
      taskName: task.name,
      status: 'succeeded',
      trigger: 'manual',
      attempt: 1,
      resumable: false,
      message: '',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '2026-08-08T01:01:00.000Z',
      rowsRead: 10,
      rowsWritten: 10,
      rowsFailed: 0,
      throughput: 10,
      checkpoint: '',
    };

    expect(resolveDataSyncSidebarRefreshes({
      previousStatuses: new Map([[completedRun.id, 'running']]),
      runs: [completedRun],
      tasks: [task],
    })).toEqual([{
      runId: completedRun.id,
      request: {
        connectionId: 'postgres-warehouse',
        dbName: 'warehouse',
        schemaName: 'ods',
        reason: 'data-sync',
      },
    }]);
    expect(resolveDataSyncSidebarRefreshes({
      previousStatuses: new Map([[completedRun.id, 'succeeded']]),
      runs: [completedRun],
      tasks: [task],
    })).toEqual([]);
    expect(resolveDataSyncSidebarRefreshes({
      previousStatuses: new Map(),
      runs: [completedRun],
      tasks: [task],
    })).toEqual([]);
  });

  it('keeps an entry-point task while loading unrelated persisted tasks', async () => {
    const entryTask = {
      ...buildTask(),
      id: 'data-sync-local-schema-compare',
      name: '表结构比对',
    };
    const persistedTask = {
      ...buildTask(),
      id: 'persisted-task-1',
      name: '已保存任务',
    };
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [persistedTask],
    });
    const gateway = {
      ...baseGateway,
      listTasks: async () => [persistedTask],
    };

    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[entryTask]}
        gateway={gateway}
        locale="zh-CN"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({
      'data-task-id': entryTask.id,
    })).toBeTruthy();
    expect(renderer.root.findByProps({
      'data-task-id': persistedTask.id,
    })).toBeTruthy();
    expect(renderer.root.findByProps({
      'data-task-id': entryTask.id,
      'data-selected': 'true',
    })).toBeTruthy();
  });

  it('prefers the persisted task when an entry task has the same id', () => {
    const initialTask = { ...buildTask(), id: 'same-task', name: '入口版本' };
    const loadedTask = { ...initialTask, name: '持久化版本', revision: initialTask.revision + 1 };

    expect(mergeDataSyncInitialTasks([initialTask], [loadedTask])).toEqual([loadedTask]);
  });

  it('renders a compact full-page shell with route, task list, and five editor stages', () => {
    const task = buildTask();
    const markup = renderToStaticMarkup(
      <DataSyncWorkbenchShell initialTasks={[task]} locale="zh-CN" />,
    );

    expect(markup).toContain('data-data-sync-workbench-shell="true"');
    expect(markup).toContain('data-data-sync-route="true"');
    expect(markup).toContain('data-data-sync-task-editor="true"');
    expect(markup).toContain('data-data-sync-preflight="true"');
    expect(markup).toContain('订单同步');
    expect(markup).toContain('MySQL 生产库');
    expect(markup).toContain('PostgreSQL 数仓');
    expect((markup.match(/gn-data-sync-stage-nav/g) || []).length).toBeGreaterThan(0);
    expect(markup).not.toContain('ant-card');
    expect(markup).not.toContain('linear-gradient');
  });

  it('edits mappings and marks the task revision as dirty', async () => {
    const task = buildTask();
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Choose data'))!
        .props.onClick();
    });

    const mappingSection = renderer.root.findByProps({
      'data-data-sync-mapping-section': 'true',
    });
    const targetInput = mappingSection
      .findAllByType('input')
      .find((input) => input.props.value === 'ods.orders')!;
    act(() => {
      targetInput.props.onChange({ target: { value: 'ods.orders_v2' } });
    });

    expect(renderer.root.findByProps({ 'data-dirty': 'true' })).toBeTruthy();
    expect(
      renderer.root
        .findAllByType('input')
        .some((input) => input.props.value === 'ods.orders_v2'),
    ).toBe(true);
  });

  it('adapts run history and quarantined rows through the injected gateway', async () => {
    const task = buildTask();
    const run: DataSyncRunRecord = {
      id: 'run-1',
      taskId: task.id,
      taskName: task.name,
      status: 'failed',
      trigger: 'manual',
      attempt: 1,
      resumable: true,
      message: 'invalid timestamp',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '2026-08-08T01:01:00.000Z',
      rowsRead: 10,
      rowsWritten: 9,
      rowsFailed: 1,
      throughput: 9,
      checkpoint: 'orders:9',
    };
    const errorRow: DataSyncErrorRow = {
      id: 'error-1',
      runId: run.id,
      taskId: task.id,
      mappingId: 'orders-map',
      sourceObject: 'orders',
      reason: 'invalid timestamp',
      payloadPreview: '{"id":10}',
      retryable: true,
      status: 'pending',
      operation: 'insert',
    };
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      runs: [run],
      errorRowsByRun: { [run.id]: [errorRow] },
    });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Runs'))!
        .props.onClick();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('View run details'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ 'data-data-sync-run-history': 'true' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ children: 'invalid timestamp' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ children: '{"id":10}' })).toHaveLength(1);
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Discard'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      renderer.root
        .findAllByType('button')
        .some((button) => button.children.includes('Discarded')),
    ).toBe(true);

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Delete record'))!
        .props.onClick();
      await Promise.resolve();
    });
    expect(
      latestConfirmation(),
    ).toMatchObject({
      title: 'Delete run record',
      content: 'Delete this run record and its error rows and event details? The checkpoint is retained.',
      okText: 'Delete record',
      centered: true,
      closable: true,
      maskClosable: true,
      okButtonProps: { danger: true, type: 'primary' },
    });

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Clear completed records'))!
        .props.onClick();
      await Promise.resolve();
    });
    expect(
      latestConfirmation(),
    ).toMatchObject({
      title: 'Clear completed records',
      content: 'Clear all completed run records and their error rows and event details? Checkpoints are retained.',
      okText: 'Clear completed records',
    });
  });

  it('rekeys a local draft and its preflight when persistence assigns an ID', async () => {
    const task = {
      ...buildTask(),
      id: 'data-sync-local-draft-1',
    };
    const baseGateway = createStaticDataSyncWorkbenchGateway({ tasks: [task] });
    const gateway = {
      ...baseGateway,
      async saveTask(submitted: typeof task) {
        return { ...submitted, id: 'persisted-task-42' };
      },
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const taskName = renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === task.name)!;
    act(() => {
      taskName.props.onChange({ target: { value: 'Renamed before save' } });
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      renderer.root.findByProps({ 'data-approval-required': 'false' }),
    ).toBeTruthy();

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Save draft'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      renderer.root.findByProps({
        'data-task-id': 'persisted-task-42',
        'data-selected': 'true',
      }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ 'data-task-id': 'data-sync-local-draft-1' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({
        'data-data-sync-preflight': 'true',
        'data-preflight-task-id': 'persisted-task-42',
        'data-status': 'stale',
      }),
    ).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-dirty': 'false' })).toBeTruthy();
  });

  it('shows approval-required preflight state and keeps execution fail-closed', async () => {
    const task = buildTask();
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
      approvalRequiredByTask: { [task.id]: true },
      definitionHashByTask: { [task.id]: 'production-definition' },
    });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      renderer.root.findAllByProps({ 'data-approval-required': 'true' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run task'))!.props.disabled,
    ).toBe(true);
  });

  it('deletes the selected task after confirmation and selects the remaining one', async () => {
    const task = buildTask();
    const other = { ...buildTask(), id: 'other-task', name: '其他任务' };
    const deleteSpy = vi.fn(async () => {});
    const gateway = {
      ...createStaticDataSyncWorkbenchGateway({ tasks: [task, other] }),
      deleteTask: deleteSpy,
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task, other]}
        gateway={gateway}
        locale="en-US"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const findDeleteButton = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Delete task'))!;

    // 取消确认时不做任何删除。
    await act(async () => {
      findDeleteButton().props.onClick();
      await Promise.resolve();
    });
    expect(
      latestConfirmation(),
    ).toMatchObject({
      title: 'Delete task',
      okText: 'Delete task',
      centered: true,
      closable: true,
      maskClosable: true,
    });
    expect(deleteSpy).not.toHaveBeenCalled();

    await act(async () => {
      findDeleteButton().props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      await latestConfirmation().onOk();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteSpy).toHaveBeenCalledWith(task.id);
    expect(
      renderer.root.findAllByProps({ 'data-task-id': task.id }),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({
        'data-task-id': other.id,
        'data-selected': 'true',
      }),
    ).toBeTruthy();
  });

  it('publishes a draft as ready through one preflight-and-save operation', async () => {
    const task = buildTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
    });
    const saveTask = vi.fn(async (submitted: typeof task) => ({
      ...submitted,
      revision: submitted.revision + 1,
    }));
    const gateway = { ...baseGateway, saveTask };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Publish as ready'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle: 'ready' }),
    );
    expect(
      renderer.root.findByProps({ 'data-dirty': 'false' }),
    ).toBeTruthy();
    expect(renderer.root.findByProps({
      'data-data-sync-preflight': 'true',
      'data-status': 'passed',
    })).toBeTruthy();
  });

  it('does not revive a deleted local entry task when the initial load resolves late', async () => {
    const localTask = {
      ...buildTask(),
      id: 'data-sync-local-entry-task',
      name: 'Local entry task',
    };
    const persistedTask = { ...buildTask(), id: 'persisted-task', name: 'Persisted task' };
    let resolveTasks: (tasks: typeof persistedTask[]) => void = () => undefined;
    const delayedTasks = new Promise<typeof persistedTask[]>((resolve) => {
      resolveTasks = resolve;
    });
    const baseGateway = createStaticDataSyncWorkbenchGateway({ tasks: [persistedTask] });
    const gateway = { ...baseGateway, listTasks: vi.fn(() => delayedTasks) };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[localTask]} gateway={gateway} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Delete task'))!
        .props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      await latestConfirmation().onOk();
      await Promise.resolve();
    });
    await act(async () => {
      resolveTasks([persistedTask]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({ 'data-task-id': localTask.id })).toHaveLength(0);
    expect(renderer.root.findByProps({ 'data-task-id': persistedTask.id })).toBeTruthy();
  });

  it('keeps persisted tasks visible when run-history loading fails', async () => {
    const task = buildTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({ tasks: [task] });
    const gateway = {
      ...baseGateway,
      listRunsPage: vi.fn(async () => {
        throw new Error('run history is temporarily unavailable');
      }),
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[]}
        gateway={gateway}
        locale="en-US"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });

    expect(renderer.root.findByProps({
      'data-task-id': task.id,
    })).toBeTruthy();
  });

  it('localizes the run page-size control and reloads its first page at the selected size', async () => {
    const task = buildTask();
    const runs: DataSyncRunRecord[] = Array.from({ length: 27 }, (_, index) => ({
      id: `run-page-${index + 1}`,
      taskId: task.id,
      taskName: task.name,
      status: 'succeeded',
      trigger: 'manual',
      attempt: 1,
      resumable: false,
      message: '',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '2026-08-08T01:01:00.000Z',
      rowsRead: 1,
      rowsWritten: 1,
      rowsFailed: 0,
      throughput: 1,
      checkpoint: '',
    }));
    const gateway = createStaticDataSyncWorkbenchGateway({ tasks: [task], runs });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="zh-CN"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('运行记录'))!
        .props.onClick();
    });

    const pageSize = renderer.root.findAllByType('select').find(
      (select) => select.props.value === 10,
    )!;
    expect(renderer.root.findAllByProps({ children: '每页' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ children: '共 27 条' })).toHaveLength(1);
    expect(renderer.root.findByType('tbody').findAllByType('tr')).toHaveLength(10);

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('下一页'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ children: '第 2 页' })).toHaveLength(1);

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('上一页'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ children: '第 1 页' })).toHaveLength(1);

    await act(async () => {
      renderer.root.findAllByType('select').find(
        (select) => select.props.value === 10,
      )!.props.onChange({ target: { value: '50' } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByType('select').some(
      (select) => select.props.value === 50,
    )).toBe(true);
    expect(renderer.root.findByType('tbody').findAllByType('tr')).toHaveLength(27);
  });

  it('reloads the authoritative first run page after starting a task', async () => {
    const task = { ...buildTask(), lifecycle: 'ready' as const };
    const runs: DataSyncRunRecord[] = Array.from({ length: 10 }, (_, index) => ({
      id: `existing-run-${index + 1}`,
      taskId: task.id,
      taskName: task.name,
      status: 'succeeded',
      trigger: 'manual',
      attempt: 1,
      resumable: false,
      message: '',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '2026-08-08T01:01:00.000Z',
      rowsRead: 1,
      rowsWritten: 1,
      rowsFailed: 0,
      throughput: 1,
      checkpoint: '',
    }));
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      runs,
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
    });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} gateway={gateway} locale="zh-CN" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('运行预检'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('运行任务'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByType('tbody').findAllByType('tr')).toHaveLength(10);
    expect(renderer.root.findAllByProps({ children: '共 11 条' })).toHaveLength(1);
  });

  it('keeps opened run details when refreshing a visible active run', async () => {
    const task = buildTask();
    const run: DataSyncRunRecord = {
      id: 'active-run',
      taskId: task.id,
      taskName: task.name,
      status: 'running',
      trigger: 'manual',
      attempt: 1,
      resumable: true,
      message: '',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '',
      rowsRead: 10,
      rowsWritten: 8,
      rowsFailed: 1,
      throughput: 8,
      checkpoint: 'orders:8',
    };
    const errorRow: DataSyncErrorRow = {
      id: 'active-error',
      runId: run.id,
      taskId: task.id,
      mappingId: 'orders-map',
      sourceObject: 'orders',
      reason: 'pending row error',
      payloadPreview: '{"id":8}',
      retryable: false,
      status: 'pending',
      operation: 'update',
    };
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      runs: [run],
      errorRowsByRun: { [run.id]: [errorRow] },
    });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} gateway={gateway} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Runs'))!
        .props.onClick();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('View run details'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ children: '{"id":8}' })).toHaveLength(1);

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Refresh'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({ children: '{"id":8}' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ children: 'pending row error' })).toHaveLength(1);
  });

  it('refreshes the task revision after a production run consumes approval', async () => {
    const task = { ...buildTask(), lifecycle: 'ready' as const };
    const refreshedTask = { ...task, revision: task.revision + 1 };
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
    });
    let listCount = 0;
    const gateway = {
      ...baseGateway,
      listTasks: vi.fn(async () => {
        listCount += 1;
        return listCount === 1 ? [task] : [refreshedTask];
      }),
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} gateway={gateway} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run task'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gateway.listTasks).toHaveBeenCalledTimes(2);
  });

  it('ignores stale run-detail responses after another run is selected', async () => {
    const task = buildTask();
    const runA: DataSyncRunRecord = {
      id: 'run-a', taskId: task.id, taskName: task.name, status: 'failed', trigger: 'manual',
      attempt: 1, resumable: true, message: '', startedAt: '', finishedAt: '', rowsRead: 0,
      rowsWritten: 0, rowsFailed: 1, throughput: 0, checkpoint: '',
    };
    const runB: DataSyncRunRecord = { ...runA, id: 'run-b' };
    let resolveRunA: (rows: DataSyncErrorRow[]) => void = () => undefined;
    const runARows = new Promise<DataSyncErrorRow[]>((resolve) => {
      resolveRunA = resolve;
    });
    const rowFor = (runId: string): DataSyncErrorRow => ({
      id: `error-${runId}`,
      runId,
      taskId: task.id,
      mappingId: 'orders-map',
      sourceObject: 'orders',
      reason: `failure-${runId}`,
      payloadPreview: `{"run":"${runId}"}`,
      retryable: false,
      status: 'pending',
      operation: 'insert',
    });
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      runs: [runA, runB],
    });
    const gateway = {
      ...baseGateway,
      listErrorRows: vi.fn((runId: string) =>
        runId === runA.id ? runARows : Promise.resolve([rowFor(runId)]),
      ),
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} gateway={gateway} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Runs'))!
        .props.onClick();
    });
    const detailButtons = renderer.root
      .findAllByType('button')
      .filter((button) => button.children.includes('View run details'));
    act(() => {
      detailButtons[0].props.onClick();
      detailButtons[1].props.onClick();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ children: '{"run":"run-b"}' })).toHaveLength(1);

    await act(async () => {
      resolveRunA([rowFor(runA.id)]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ children: '{"run":"run-b"}' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ children: '{"run":"run-a"}' })).toHaveLength(0);
  });

  it('keeps a blocked publication as a draft without saving it', async () => {
    const task = buildTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({ tasks: [task] });
    const saveTask = vi.fn(baseGateway.saveTask);
    const gateway = {
      ...baseGateway,
      saveTask,
      preflightTask: vi.fn(async (submitted: typeof task) => ({
        taskId: submitted.id,
        taskRevision: submitted.revision,
        taskEditEpoch: submitted.editEpoch,
        status: 'blocked' as const,
        issues: [
          {
            id: 'target-required',
            code: 'target_connection_required' as const,
            severity: 'blocker' as const,
            stage: 'endpoints' as const,
            message: 'target configuration is incomplete',
          },
        ],
        definitionHash: 'blocked-publication',
        approvalRequired: false,
        approvalSatisfied: false,
        checkedAt: '2026-08-08T00:00:00.000Z',
      })),
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Publish as ready'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveTask).not.toHaveBeenCalled();
    expect(
      renderer.root
        .findAllByType('button')
        .some((button) => button.children.includes('Publish as ready')),
    ).toBe(true);
    expect(renderer.root.findByProps({
      'data-data-sync-preflight': 'true',
      'data-status': 'blocked',
    })).toBeTruthy();
  });

  it('saves a publication candidate immediately after its production approval', async () => {
    const task = buildTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      approvalRequiredByTask: { [task.id]: true },
      definitionHashByTask: { [task.id]: 'production-definition' },
    });
    const saveTask = vi.fn(async (submitted: typeof task) => ({
      ...submitted,
      revision: submitted.revision + 1,
    }));
    const gateway = {
      ...baseGateway,
      saveTask,
      beginApproval: vi.fn(async () => ({
        taskId: task.id,
        definitionHash: 'production-definition',
        notBefore: '2020-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
      })),
      approveTask: vi.fn(async () => ({
        definitionHash: 'production-definition',
        expiresAt: '2030-01-01T00:00:00.000Z',
      })),
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Publish as ready'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      renderer.root.findAllByType('button').map((button) => button.children.join('')),
    ).toContain('Begin server 10-second confirmation');
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Begin server 10-second confirmation'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Confirm production write and grant token'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle: 'ready' }),
    );
    expect(renderer.root.findByProps({ 'data-dirty': 'false' })).toBeTruthy();
  });

  it('explains that a dirty ready task must be saved after a current preflight', async () => {
    const task = { ...buildTask(), lifecycle: 'ready' as const };
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
    });
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Choose source and target'))!
        .props.onClick();
      await Promise.resolve();
    });

    const taskName = renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === task.name)!;
    act(() => {
      taskName.props.onChange({ target: { value: 'Unsaved ready edit' } });
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const runButton = renderer.root
      .findAllByType('button')
      .find((button) => button.children.includes('Run task'))!;
    expect(runButton.props.disabled).toBe(true);
    expect(runButton.props.title).toBe('Current preflight passed; save the task first');
  });

  it('keeps a ready task runnable after saving the revision that was preflighted', async () => {
    const task = { ...buildTask(), lifecycle: 'ready' as const };
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      capabilities: {
        [task.id]: {
          level: 'full',
          canExecute: true,
          supportsAutoCreate: true,
          supportsCdc: false,
        },
      },
    });
    const gateway = {
      ...baseGateway,
      async saveTask(submitted: typeof task) {
        return {
          ...submitted,
          revision: submitted.revision + 1,
        };
      },
    };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell
        initialTasks={[task]}
        gateway={gateway}
        locale="en-US"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const taskName = renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === task.name)!;
    act(() => {
      taskName.props.onChange({ target: { value: 'Renamed ready task' } });
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run preflight'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      renderer.root.findByProps({
        'data-data-sync-preflight': 'true',
        'data-status': 'passed',
      }),
    ).toBeTruthy();

    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Save draft'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ 'data-dirty': 'false' })).toBeTruthy();
    expect(
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Run task'))!.props.disabled,
    ).toBe(false);
  });

  it('enables checkpoint reset only for a paused task and requires confirmation', async () => {
    const task = { ...buildTask(), lifecycle: 'paused' as const };
    const run: DataSyncRunRecord = {
      id: 'checkpoint-run',
      taskId: task.id,
      taskName: task.name,
      status: 'failed',
      trigger: 'manual',
      attempt: 1,
      resumable: true,
      message: '',
      startedAt: '2026-08-08T01:00:00.000Z',
      finishedAt: '2026-08-08T01:01:00.000Z',
      rowsRead: 10,
      rowsWritten: 10,
      rowsFailed: 0,
      throughput: 10,
      checkpoint: 'orders:10',
    };
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      runs: [run],
      checkpointsByTask: {
        [task.id]: {
          taskId: task.id,
          runId: run.id,
          kind: 'watermark',
          phase: 'batch_committed',
          cursorPreview: '{"id":10}',
          updatedAt: '2026-08-08T01:01:00.000Z',
        },
      },
    });
    const resetCheckpoint = vi.fn(baseGateway.resetCheckpoint.bind(baseGateway));
    const gateway = { ...baseGateway, resetCheckpoint };
    const renderer = TestRenderer.create(
      <DataSyncWorkbenchShell initialTasks={[task]} gateway={gateway} locale="en-US" />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Runs'))!
        .props.onClick();
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('View run details'))!
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    const resetButton = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Reset checkpoint'))!;
    expect(resetButton().props.disabled).toBe(false);

    await act(async () => {
      resetButton().props.onClick();
      await Promise.resolve();
    });
    expect(
      latestConfirmation(),
    ).toMatchObject({
      title: 'Reset checkpoint',
      okText: 'Reset checkpoint',
      centered: true,
      closable: true,
      maskClosable: true,
    });
    expect(resetCheckpoint).not.toHaveBeenCalled();

    await act(async () => {
      resetButton().props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      await latestConfirmation().onOk();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resetCheckpoint).toHaveBeenCalledWith(task.id, task.revision);
    expect(resetButton().props.disabled).toBe(true);
  });
});
