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
  type DataSyncRunRecord,
  type DataSyncTaskDefinition,
} from './model';
import { DataSyncWorkbenchShell } from './DataSyncWorkbenchShell';

const NOW = '2026-09-02T06:00:00.000Z';

const CAN_EXECUTE = {
  level: 'full',
  canExecute: true,
  supportsAutoCreate: true,
  supportsMutations: true,
  supportsCdc: false,
} as const;

const baseScheduledTask = (): DataSyncTaskDefinition => ({
  ...createDataSyncTaskDraft({
    id: 'scheduled-a',
    kind: 'reconcile',
    name: '订单同步',
    now: '2026-09-01T00:00:00.000Z',
  }),
  revision: 3,
  lifecycle: 'enabled',
  source: {
    connectionId: 'mysql-prod',
    connectionName: 'MySQL 生产库',
    type: 'mysql',
    database: 'sales',
    schema: '',
  },
  target: {
    connectionId: 'pg-warehouse',
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
  trigger: {
    mode: 'cron',
    expression: '0 2 * * *',
    timezone: 'Asia/Shanghai',
    overlap: 'skip',
  },
});

const buildScheduledTask = (
  overrides: Partial<DataSyncTaskDefinition> = {},
): DataSyncTaskDefinition => ({
  ...baseScheduledTask(),
  ...overrides,
});

const buildRun = (
  id: string,
  taskId: string,
  overrides: Partial<DataSyncRunRecord> = {},
): DataSyncRunRecord => ({
  id,
  taskId,
  taskName: overrides.taskName || taskId,
  status: 'succeeded',
  trigger: 'schedule',
  attempt: 1,
  resumable: false,
  message: '',
  startedAt: '2026-09-01T02:00:00.000Z',
  finishedAt: '2026-09-01T02:01:00.000Z',
  rowsRead: 5,
  rowsWritten: 5,
  rowsFailed: 0,
  throughput: 5,
  checkpoint: '',
  ...overrides,
});

const scheduleRowFor = (task: DataSyncTaskDefinition) => ({
  id: `${task.id}:schedule`,
  taskId: task.id,
  taskName: task.name,
  enabled: task.lifecycle === 'enabled',
  expression: '0 2 * * *',
  timezone: 'Asia/Shanghai',
  nextRunAt: task.lifecycle === 'enabled' ? '2026-09-03T02:00:00.000Z' : '',
});

const latestConfirmation = (): {
  title: string;
  content: React.ReactElement;
  okText: string;
  onOk: () => Promise<void>;
  onCancel: () => void;
} => modalConfirm.mock.calls[modalConfirm.mock.calls.length - 1]![0];

const flush = async (rounds = 6) => {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
};

/** Recursively collect the rendered text of a test-renderer subtree. */
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (
    node &&
    typeof node === 'object' &&
    'children' in (node as Record<string, unknown>)
  ) {
    return textOf((node as { children: unknown }).children);
  }
  return '';
};

const renderShell = async (
  gateway: unknown,
  initialTasks: DataSyncTaskDefinition[],
) => {
  const renderer = TestRenderer.create(
    <DataSyncWorkbenchShell
      initialTasks={initialTasks}
      gateway={gateway as React.ComponentProps<
        typeof DataSyncWorkbenchShell
      >['gateway']}
      locale="zh-CN"
    />,
  );
  await flush();
  return renderer;
};

const openSchedules = async (
  renderer: TestRenderer.ReactTestRenderer,
): Promise<void> => {
  await act(async () => {
    renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === '调度')!
      .props.onClick();
    await Promise.resolve();
  });
  await flush();
};

const scheduleRow = (
  renderer: TestRenderer.ReactTestRenderer,
  taskId: string,
): TestRenderer.ReactTestInstance =>
  renderer.root.findByProps({ 'data-task-id': taskId });

const rowButton = (
  renderer: TestRenderer.ReactTestRenderer,
  taskId: string,
  label: string,
): TestRenderer.ReactTestInstance =>
  scheduleRow(renderer, taskId)
    .findAllByType('button')
    .find((button) => button.props.children === label)!;

const clickRowButton = async (
  renderer: TestRenderer.ReactTestRenderer,
  taskId: string,
  label: string,
) => {
  await act(async () => {
    rowButton(renderer, taskId, label).props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('DataSyncWorkbenchShell schedule control', () => {
  afterEach(() => {
    modalConfirm.mockReset();
    vi.useRealTimers();
  });

  it('pauses an enabled schedule with the stored revision and refreshes the authoritative rows', async () => {
    const taskA = buildScheduledTask();
    const taskB = buildScheduledTask({ id: 'scheduled-b', name: '库存同步' });
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA, taskB],
      schedules: [scheduleRowFor(taskA), scheduleRowFor(taskB)],
      runs: [],
      now: () => NOW,
    });
    const listTasks = vi.fn(() => baseGateway.listTasks());
    const saveTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.saveTask(task),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        listTasks,
        saveTask,
      },
      [taskA, taskB],
    );

    await openSchedules(renderer);
    expect(scheduleRow(renderer, 'scheduled-a').props['data-enabled']).toBe(
      'true',
    );

    await clickRowButton(renderer, 'scheduled-a', '暂停');

    expect(modalConfirm).toHaveBeenCalledTimes(1);
    const confirmation = latestConfirmation();
    expect(confirmation.title).toBe('确定暂停任务“订单同步”吗？');
    const details = renderToStaticMarkup(confirmation.content);
    expect(details).toContain('源端：MySQL 生产库 / sales');
    expect(details).toContain('目标端：PostgreSQL 数仓 / warehouse / ods');
    expect(details).toContain('在途运行会被取消，后续调度不会再触发。');
    expect(saveTask).not.toHaveBeenCalled();

    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveTask).toHaveBeenCalledTimes(1);
    const submitted = saveTask.mock.calls[0]![0] as DataSyncTaskDefinition;
    expect(submitted).toMatchObject({
      id: 'scheduled-a',
      lifecycle: 'paused',
      // Store.PutJob receives the persisted revision and advances it itself.
      revision: 3,
    });
    expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      scheduleRow(renderer, 'scheduled-a').props['data-enabled'],
    ).toBe('false');
    // Task B's row is untouched by task A's lifecycle change.
    expect(
      scheduleRow(renderer, 'scheduled-b').props['data-enabled'],
    ).toBe('true');
    expect(scheduleRow(renderer, 'scheduled-b').props.children).toBeTruthy();
  });

  it('keeps the stored state untouched when the operator cancels the confirmation', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      runs: [],
      now: () => NOW,
    });
    const saveTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.saveTask(task),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        saveTask,
      },
      [taskA],
    );

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '暂停');

    const confirmation = latestConfirmation();
    await act(async () => {
      confirmation.onCancel();
      await Promise.resolve();
    });

    expect(saveTask).not.toHaveBeenCalled();
    expect(
      scheduleRow(renderer, 'scheduled-a').props['data-enabled'],
    ).toBe('true');
  });

  it('re-enables a paused schedule through a fresh preflight without faking the state', async () => {
    const paused = buildScheduledTask({ lifecycle: 'paused' });
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [paused],
      schedules: [scheduleRowFor(paused)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      runs: [],
      now: () => NOW,
    });
    const saveTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.saveTask(task),
    );
    const preflightTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.preflightTask(task),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        saveTask,
        preflightTask,
      },
      [paused],
    );

    await openSchedules(renderer);
    expect(
      scheduleRow(renderer, 'scheduled-a').props['data-enabled'],
    ).toBe('false');

    await clickRowButton(renderer, 'scheduled-a', '启用');
    const confirmation = latestConfirmation();
    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preflightTask).toHaveBeenCalledTimes(1);
    expect(saveTask).toHaveBeenCalledTimes(1);
    expect(saveTask.mock.calls[0]![0]).toMatchObject({
      id: 'scheduled-a',
      lifecycle: 'enabled',
      revision: 3,
    });
    expect(
      scheduleRow(renderer, 'scheduled-a').props['data-enabled'],
    ).toBe('true');
  });

  it('routes an enable that requires production approval into the editor instead of saving', async () => {
    const paused = buildScheduledTask({ lifecycle: 'paused' });
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [paused],
      schedules: [scheduleRowFor(paused)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      approvalRequiredByTask: { 'scheduled-a': true },
      runs: [],
      now: () => NOW,
    });
    const saveTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.saveTask(task),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        saveTask,
      },
      [paused],
    );

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '启用');

    const confirmation = latestConfirmation();
    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fail closed: no save, the enabled definition waits in the editor.
    expect(saveTask).not.toHaveBeenCalled();
    expect(
      renderer.root
        .findAllByProps({ 'aria-current': 'page' })
        .map((button) => button.props.children),
    ).toContain('任务');
    renderer.root.findByProps({ 'data-data-sync-preflight': 'true' });
    const errorTexts = renderer.root
      .findAllByProps({ className: 'gn-data-sync-workbench-error__message' })
      .map((message) => textOf(message));
    expect(errorTexts.join('\n')).toContain('需要先在编辑器中完成预检或审批');
    expect(renderer.root.findByProps({ 'data-dirty': 'true' })).toBeTruthy();
  });

  it('runs an eligible schedule now and opens the queued run in the history', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      runs: [],
      now: () => NOW,
    });
    const startTask = vi.fn(
      (task: DataSyncTaskDefinition, preflight: unknown) =>
        baseGateway.startTask(task, preflight as never),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        startTask,
      },
      [taskA],
    );

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '立即运行');

    expect(modalConfirm).toHaveBeenCalledTimes(1);
    const confirmation = latestConfirmation();
    expect(confirmation.title).toBe('确定立即运行任务“订单同步”吗？');
    expect(renderToStaticMarkup(confirmation.content)).toContain(
      '源端：MySQL 生产库 / sales',
    );

    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startTask).toHaveBeenCalledTimes(1);
    expect(startTask.mock.calls[0]![0]).toMatchObject({
      id: 'scheduled-a',
      revision: 3,
    });
    // The workbench lands on the run history with the fresh run selected.
    const history = renderer.root.findByProps({
      'data-data-sync-run-history': 'true',
    });
    expect(history).toBeTruthy();
    const selectedRow = history.findAllByType('tr').find(
      (row) => row.props['data-selected'] === 'true',
    );
    expect(selectedRow).toBeTruthy();
    expect(textOf(selectedRow)).toContain('scheduled-a');
  });

  it('routes an immediate run that requires production approval into the editor instead of starting', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      approvalRequiredByTask: { 'scheduled-a': true },
      runs: [],
      now: () => NOW,
    });
    const startTask = vi.fn(() =>
      Promise.reject(new Error('start must not be called')),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        startTask,
      },
      [taskA],
    );

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '立即运行');
    const confirmation = latestConfirmation();
    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The fresh preflight invalidates any cached approval token, so starting
    // here would burn the grant and fail; fail closed into the editor instead.
    expect(startTask).not.toHaveBeenCalled();
    renderer.root.findByProps({ 'data-data-sync-preflight': 'true' });
    const alertTexts = renderer.root
      .findAllByProps({ role: 'alert' })
      .map((alert) => textOf(alert));
    expect(alertTexts.join('\n')).toContain('需要先在编辑器中完成预检或审批');
    // Nothing changed about the task: no dirty draft is fabricated.
    expect(renderer.root.findAllByProps({ 'data-dirty': 'true' })).toHaveLength(
      0,
    );
  });

  it('fails closed when the immediate run hits a blocked preflight', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      extraPreflightIssues: [
        {
          id: 'fixture-blocker',
          severity: 'blocker',
          code: 'definition_invalid',
          stage: 'endpoints',
          message: 'fixture blocker',
        },
      ],
      runs: [],
      now: () => NOW,
    });
    const startTask = vi.fn(() =>
      Promise.reject(new Error('start must not be called')),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        startTask,
      },
      [taskA],
    );

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '立即运行');
    const confirmation = latestConfirmation();
    await act(async () => {
      await confirmation.onOk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startTask).not.toHaveBeenCalled();
    renderer.root.findByProps({ 'data-data-sync-preflight': 'true' });
    const alertTexts = renderer.root
      .findAllByProps({ role: 'alert' })
      .map((alert) => textOf(alert));
    expect(alertTexts.join('\n')).toContain('需要先在编辑器中完成预检或审批');
  });

  it('isolates task rows and opens an off-page latest run from the schedule row', async () => {
    const taskA = buildScheduledTask();
    const taskB = buildScheduledTask({ id: 'scheduled-b', name: '库存同步' });
    const taskC = buildScheduledTask({ id: 'scheduled-c', name: '日志搬运' });
    // Twelve newer unrelated runs push task A's failed run off the first
    // history page, so only the per-task history load can find it.
    const unrelatedRuns = Array.from({ length: 12 }, (_, index) =>
      buildRun(`run-c-${index}`, 'scheduled-c', {
        taskName: '日志搬运',
        startedAt: `2026-09-02T0${index % 10}:10:00.000Z`,
      }),
    );
    const failedRun = buildRun('run-a-failed', 'scheduled-a', {
      status: 'failed',
      finishedAt: '2026-09-01T02:05:00.000Z',
      message: 'connect failed: mysql://root:secret@db.internal/sales',
    });
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA, taskB, taskC],
      schedules: [
        scheduleRowFor(taskA),
        scheduleRowFor(taskB),
        scheduleRowFor(taskC),
      ],
      runs: [...unrelatedRuns, failedRun],
      now: () => NOW,
    });
    const renderer = await renderShell(
      { ...baseGateway },
      [taskA, taskB, taskC],
    );

    await openSchedules(renderer);
    const rowA = scheduleRow(renderer, 'scheduled-a');
    const rowB = scheduleRow(renderer, 'scheduled-b');
    expect(rowA.props['data-enabled']).toBe('true');
    expect(rowB.props['data-enabled']).toBe('true');
    // Per-task run history surfaces each task's own sanitized latest failure;
    // the row shows the summary, not the raw run id.
    const rowTextA = textOf(rowA);
    const rowTextB = textOf(rowB);
    expect(rowTextA).toContain('失败');
    expect(rowTextA).toContain(
      'connect failed: mysql://[REDACTED]@db.internal/sales',
    );
    expect(rowTextB).not.toContain('connect failed');

    await act(async () => {
      rowA
        .findAllByType('button')
        .find((button) => button.props.children === '查看运行记录')!
        .props.onClick();
      await Promise.resolve();
    });
    await flush(10);

    const history = renderer.root.findByProps({
      'data-data-sync-run-history': 'true',
    });
    const selectedRow = history.findAllByType('tr').find(
      (row) => row.props['data-selected'] === 'true',
    );
    expect(textOf(selectedRow)).toContain('run-a-failed');
    expect(
      renderer.root.findByProps({ 'data-data-sync-task-failure': 'true' })
        .props.children,
    ).toBeTruthy();
  });

  it('refreshes the schedule rows after saving a scheduled task in the editor', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      capabilities: { 'scheduled-a': CAN_EXECUTE },
      runs: [],
      now: () => NOW,
    });
    const renderer = await renderShell({ ...baseGateway }, [taskA]);

    const taskName = renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === taskA.name)!;
    act(() => {
      taskName.props.onChange({ target: { value: '订单同步（改名）' } });
    });
    await flush();

    const saveButton = renderer.root.findByProps({
      'data-dirty': 'true',
    });
    await act(async () => {
      saveButton.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await openSchedules(renderer);
    expect(textOf(scheduleRow(renderer, 'scheduled-a'))).toContain(
      '订单同步（改名）',
    );
  });

  it('refuses schedule actions while the task has unsaved editor edits', async () => {
    const taskA = buildScheduledTask();
    const baseGateway = createStaticDataSyncWorkbenchGateway({
      tasks: [taskA],
      schedules: [scheduleRowFor(taskA)],
      runs: [],
      now: () => NOW,
    });
    const saveTask = vi.fn((task: DataSyncTaskDefinition) =>
      baseGateway.saveTask(task),
    );
    const renderer = await renderShell(
      {
        ...baseGateway,
        saveTask,
      },
      [taskA],
    );

    const taskName = renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === taskA.name)!;
    act(() => {
      taskName.props.onChange({ target: { value: '脏编辑' } });
    });
    await flush();

    await openSchedules(renderer);
    await clickRowButton(renderer, 'scheduled-a', '暂停');

    expect(modalConfirm).not.toHaveBeenCalled();
    expect(saveTask).not.toHaveBeenCalled();
    expect(
      textOf(
        renderer.root.findByProps({
          className: 'gn-data-sync-workbench-error__message',
        }),
      ),
    ).toContain('未保存的编辑');
  });
});
