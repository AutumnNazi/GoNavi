import { describe, expect, it } from 'vitest';

import {
  createDataSyncTaskDraft,
  reviseDataSyncTask,
  type DataSyncRunRecord,
  type DataSyncTaskDefinition,
} from './model';
import {
  aggregateDataSyncScheduleSummaries,
  pickLatestDataSyncScheduleRun,
  summarizeDataSyncRunMessage,
} from './modelSchedule';

const buildScheduledTask = (
  overrides: Partial<DataSyncTaskDefinition> = {},
): DataSyncTaskDefinition =>
  reviseDataSyncTask(
    createDataSyncTaskDraft({
      id: 'scheduled-task-a',
      kind: 'reconcile',
      name: '订单同步',
      now: '2026-09-01T00:00:00.000Z',
    }),
    {
      lifecycle: 'enabled',
      revision: 3,
      trigger: {
        mode: 'cron',
        expression: '0 0 2 * * *',
        timezone: 'Asia/Shanghai',
        overlap: 'skip',
      },
      ...overrides,
    },
  );

const buildRun = (
  overrides: Partial<DataSyncRunRecord> & { id: string },
): DataSyncRunRecord => ({
  taskId: 'scheduled-task-a',
  taskName: '订单同步',
  status: 'failed',
  trigger: 'schedule',
  attempt: 1,
  resumable: false,
  message: '',
  startedAt: '2026-09-02T02:00:00.000Z',
  finishedAt: '2026-09-02T02:01:00.000Z',
  rowsRead: 0,
  rowsWritten: 0,
  rowsFailed: 0,
  throughput: 0,
  checkpoint: '',
  ...overrides,
});

describe('summarizeDataSyncRunMessage', () => {
  it('redacts basic and bearer credentials', () => {
    expect(
      summarizeDataSyncRunMessage('auth failed with Basic YWRtaW46c2VjcmV0'),
    ).toBe('auth failed with Basic [REDACTED]');
    expect(summarizeDataSyncRunMessage('Bearer abc123.def456 rejected')).toBe(
      'Bearer [REDACTED] rejected',
    );
  });

  it('redacts url userinfo and sensitive query parameters', () => {
    expect(
      summarizeDataSyncRunMessage(
        'dial mysql://root:hunter2@db.internal:3306/sales failed',
      ),
    ).toBe('dial mysql://[REDACTED]@db.internal:3306/sales failed');
    expect(
      summarizeDataSyncRunMessage(
        'request rejected: http://es.internal:9200/_search?password=secret%20value&size=10',
      ),
    ).toBe('request rejected: http://es.internal:9200/_search?password=[REDACTED]&size=10');
    expect(
      summarizeDataSyncRunMessage('invalid dsn: host=db password=plain-text'),
    ).toBe('invalid dsn: host=db password=[REDACTED]');
  });

  it('redacts quoted json credentials and caps the summary length', () => {
    expect(
      summarizeDataSyncRunMessage('body rejected: {"password": "hunter2"}'),
    ).toBe('body rejected: {"password": "[REDACTED]"}');
    const long = summarizeDataSyncRunMessage('x'.repeat(400));
    expect(long).toHaveLength(241);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('pickLatestDataSyncScheduleRun', () => {
  it('prefers the newest started run and breaks ties deterministically', () => {
    const older = buildRun({ id: 'run-old', startedAt: '2026-09-01T02:00:00.000Z' });
    const newer = buildRun({ id: 'run-new', startedAt: '2026-09-03T02:00:00.000Z' });
    const otherTask = buildRun({
      id: 'run-other',
      taskId: 'scheduled-task-b',
      startedAt: '2026-09-04T02:00:00.000Z',
    });
    expect(
      pickLatestDataSyncScheduleRun([older, otherTask, newer], 'scheduled-task-a'),
    ).toBe(newer);
  });
});

describe('aggregateDataSyncScheduleSummaries', () => {
  it('builds authoritative rows from tasks and keeps server nextRunAt only while enabled', () => {
    const enabled = buildScheduledTask();
    const paused = buildScheduledTask({
      id: 'scheduled-task-b',
      name: '库存同步',
      revision: 7,
      lifecycle: 'paused',
      trigger: {
        mode: 'interval',
        intervalSeconds: 300,
        timezone: 'UTC',
      },
    });
    const rows = aggregateDataSyncScheduleSummaries(
      [enabled, paused],
      [],
      [
        {
          id: 'stored-a:schedule',
          taskId: enabled.id,
          taskName: '旧名字',
          enabled: true,
          expression: 'stale',
          timezone: 'UTC',
          nextRunAt: '2026-09-03T02:00:00.000Z',
        },
        {
          id: 'stored-b:schedule',
          taskId: paused.id,
          taskName: '库存同步',
          enabled: true,
          expression: '300s',
          timezone: 'UTC',
          nextRunAt: '2026-09-03T02:00:00.000Z',
        },
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 'stored-a:schedule',
      taskId: enabled.id,
      taskName: '订单同步',
      revision: 3,
      lifecycle: 'enabled',
      enabled: true,
      expression: '0 0 2 * * *',
      timezone: 'Asia/Shanghai',
      nextRunAt: '2026-09-03T02:00:00.000Z',
      latestRun: null,
    });
    // A paused task clears its next run and flips the lifecycle projection.
    expect(rows[1]).toMatchObject({
      id: 'stored-b:schedule',
      taskId: paused.id,
      revision: 7,
      lifecycle: 'paused',
      enabled: false,
      expression: '300s',
      nextRunAt: '',
    });
  });

  it('skips manual, archived, and local draft tasks', () => {
    const scheduled = buildScheduledTask();
    const manual = buildScheduledTask({
      id: 'manual-task',
      trigger: { mode: 'manual' },
    });
    const archived = buildScheduledTask({
      id: 'archived-task',
      lifecycle: 'archived',
    });
    const draft = buildScheduledTask({ id: 'data-sync-local-1-draft' });
    expect(
      aggregateDataSyncScheduleSummaries([scheduled, manual, archived, draft]),
    ).toHaveLength(1);
  });

  it('attaches the sanitized latest run summary', () => {
    const task = buildScheduledTask();
    const failed = buildRun({
      id: 'run-1',
      message: 'connect failed: mysql://root:secret@db/sales',
    });
    const rows = aggregateDataSyncScheduleSummaries([task], [failed]);
    expect(rows[0].latestRun).toEqual({
      id: 'run-1',
      status: 'failed',
      startedAt: failed.startedAt,
      finishedAt: failed.finishedAt,
      errorSummary: 'connect failed: mysql://[REDACTED]@db/sales',
    });
  });

  it('leaves errorSummary empty for succeeded runs and messages without credentials', () => {
    const task = buildScheduledTask();
    const succeeded = buildRun({
      id: 'run-ok',
      status: 'succeeded',
      message: 'ignored after success',
    });
    const plain = buildRun({
      id: 'run-plain',
      status: 'partial',
      message: '5 rows skipped',
    });
    const rows = aggregateDataSyncScheduleSummaries([task], [succeeded, plain]);
    // The plain partial run started later and becomes the latest run.
    expect(rows[0].latestRun).toMatchObject({
      id: 'run-plain',
      errorSummary: '5 rows skipped',
    });
    expect(
      aggregateDataSyncScheduleSummaries([task], [succeeded])[0].latestRun,
    ).toMatchObject({ id: 'run-ok', errorSummary: '' });
  });
});
