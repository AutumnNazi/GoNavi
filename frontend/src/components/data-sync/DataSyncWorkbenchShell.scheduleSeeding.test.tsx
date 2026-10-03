import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { createStaticDataSyncWorkbenchGateway } from './gateway';
import { createDataSyncTableMapping, createDataSyncTaskDraft } from './model';
import type { DataSyncTaskDefinition } from './model';
import { DataSyncWorkbenchShell } from './DataSyncWorkbenchShell';

// 回归护栏：生产里 workbenchFamily 由 normalizeDataSyncEntryMode 决定，
// 只会是 'sync' 或 'compare'，永远不是空值。调度种子代码曾用
// `if (!workbenchFamily)` 作为守卫，导致默认的 'sync' 工作台也跳过种子，
// 调度列表在首次进入时恒为空（任务照常在后端按时执行，运行记录也照常写入）。
// 既有用例都不传 workbenchFamily，因此全部漏过了这个缺陷。

const scheduledBackupTask = (): DataSyncTaskDefinition => ({
  ...createDataSyncTaskDraft({
    id: 'backup-scheduled',
    kind: 'backup',
    name: '数据库备份',
    now: '2026-09-01T00:00:00.000Z',
  }),
  revision: 2,
  lifecycle: 'enabled',
  source: {
    connectionId: 'mysql-prod',
    connectionName: 'MySQL 生产库',
    type: 'mysql',
    database: 'sales',
    schema: '',
  },
  backup: { directory: '/tmp/backups', content: 'both' },
  mappings: [createDataSyncTableMapping('orders-map', 'orders', '')],
  trigger: {
    mode: 'interval',
    intervalSeconds: 60,
    timezone: 'Local',
  },
});

const scheduleRowFor = (task: DataSyncTaskDefinition) => ({
  id: `${task.id}:schedule`,
  taskId: task.id,
  taskName: task.name,
  enabled: true,
  expression: '60s',
  timezone: 'Local',
  nextRunAt: '2026-09-03T02:00:00.000Z',
});

const flush = async (rounds = 8) => {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
};

const renderShell = async (
  gateway: unknown,
  initialTasks: DataSyncTaskDefinition[],
  workbenchFamily?: 'sync' | 'compare',
) => {
  const renderer = TestRenderer.create(
    <DataSyncWorkbenchShell
      initialTasks={initialTasks}
      gateway={
        gateway as React.ComponentProps<
          typeof DataSyncWorkbenchShell
        >['gateway']
      }
      locale="zh-CN"
      workbenchFamily={workbenchFamily}
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

describe('DataSyncWorkbenchShell schedule seeding', () => {
  it('seeds the schedule list for the default sync workbench', async () => {
    const task = scheduledBackupTask();
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      schedules: [scheduleRowFor(task)],
    });

    const renderer = await renderShell(gateway, [task], 'sync');
    await openSchedules(renderer);

    const row = renderer.root.findAllByProps({
      'data-task-id': task.id,
    });
    expect(row.length).toBeGreaterThan(0);
  });

  it('keeps the schedule list reachable when no family is provided', async () => {
    const task = scheduledBackupTask();
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      schedules: [scheduleRowFor(task)],
    });

    const renderer = await renderShell(gateway, [task]);
    await openSchedules(renderer);

    const row = renderer.root.findAllByProps({
      'data-task-id': task.id,
    });
    expect(row.length).toBeGreaterThan(0);
  });

  it('does not offer a schedules view on the compare workbench', async () => {
    const task = scheduledBackupTask();
    const gateway = createStaticDataSyncWorkbenchGateway({
      tasks: [task],
      schedules: [scheduleRowFor(task)],
    });

    const renderer = await renderShell(gateway, [task], 'compare');

    const labels = renderer.root
      .findAllByType('button')
      .map((button) => button.props.children);
    expect(labels).not.toContain('调度');
  });
});
