import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { DataSyncScheduleTable } from './DataSyncScheduleTable';
import type { DataSyncScheduleSummary } from './model';
import { createDataSyncWorkbenchTranslate } from './text';

const t = createDataSyncWorkbenchTranslate('zh-CN');

const buildSchedule = (
  overrides: Partial<DataSyncScheduleSummary> = {},
): DataSyncScheduleSummary => ({
  id: 'task-a:schedule',
  taskId: 'task-a',
  taskName: '订单同步',
  revision: 3,
  lifecycle: 'enabled',
  enabled: true,
  expression: '0 0 2 * * *',
  timezone: 'Asia/Shanghai',
  nextRunAt: '2026-09-03T02:00:00.000Z',
  latestRun: null,
  ...overrides,
});

const renderTable = (
  props: Partial<React.ComponentProps<typeof DataSyncScheduleTable>> = {},
): string =>
  renderToStaticMarkup(
    <DataSyncScheduleTable
      schedules={[buildSchedule()]}
      t={t}
      refreshing={false}
      busyAction=""
      onRefresh={() => undefined}
      {...props}
    />,
  );

describe('DataSyncScheduleTable', () => {
  it('renders the six columns with per-row task hooks and actions', () => {
    const markup = renderTable({
      onToggle: () => undefined,
      onRunNow: () => undefined,
      onViewRun: () => undefined,
    });
    expect(markup).toContain('data-data-sync-schedules="true"');
    expect(markup).toContain('data-task-id="task-a"');
    expect(markup).toContain('data-enabled="true"');
    expect(markup).toContain('订单同步');
    expect(markup).toContain('0 0 2 * * *');
    expect(markup).toContain('暂停');
    expect(markup).toContain('立即运行');
    expect(markup).not.toContain('查看运行记录');
  });

  it('shows the sanitized latest run with its history shortcut', () => {
    const markup = renderTable({
      onViewRun: () => undefined,
      schedules: [
        buildSchedule({
          latestRun: {
            id: 'run-9',
            status: 'failed',
            startedAt: '2026-09-02T02:00:00.000Z',
            finishedAt: '2026-09-02T02:01:00.000Z',
            errorSummary: 'connect failed: mysql://[REDACTED]@db/sales',
          },
        }),
      ],
    });
    expect(markup).toContain('data-state="failed"');
    expect(markup).toContain('失败');
    expect(markup).toContain('connect failed: mysql://[REDACTED]@db/sales');
    expect(markup).toContain('查看运行记录');
  });

  it('routes callbacks to the matching schedule and run', () => {
    const onToggle = vi.fn();
    const onRunNow = vi.fn();
    const onViewRun = vi.fn();
    const schedule = buildSchedule({
      latestRun: {
        id: 'run-9',
        status: 'succeeded',
        startedAt: '2026-09-02T02:00:00.000Z',
        finishedAt: '2026-09-02T02:01:00.000Z',
        errorSummary: '',
      },
    });
    const renderer = TestRenderer.create(
      <DataSyncScheduleTable
        schedules={[schedule]}
        t={t}
        refreshing={false}
        busyAction=""
        onRefresh={() => undefined}
        onToggle={onToggle}
        onRunNow={onRunNow}
        onViewRun={onViewRun}
      />,
    );
    const clickButton = (label: string) => {
      act(() => {
        renderer.root
          .findAllByType('button')
          .find((button) => button.props.children === label)!
          .props.onClick();
      });
    };
    clickButton('暂停');
    clickButton('立即运行');
    clickButton('查看运行记录');
    expect(onToggle).toHaveBeenCalledWith(schedule);
    expect(onRunNow).toHaveBeenCalledWith(schedule);
    expect(onViewRun).toHaveBeenCalledWith('run-9');
  });

  it('freezes every row action and the refresh button while an operation is busy', () => {
    const markup = renderTable({
      busyAction: 'disable:task-a',
      refreshing: true,
      onToggle: () => undefined,
      onRunNow: () => undefined,
    });
    expect(markup).toContain('disabled');
    expect((markup.match(/disabled/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('shows the paused projection with a cleared next run', () => {
    const markup = renderTable({
      schedules: [
        buildSchedule({
          enabled: false,
          lifecycle: 'paused',
          nextRunAt: '',
        }),
      ],
      onToggle: () => undefined,
    });
    expect(markup).toContain('已暂停');
    expect(markup).toContain('启用');
    expect(markup).not.toContain('已启用');
  });
});
