import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  finishDataSyncBackgroundTask,
  getDataSyncBackgroundTask,
  resetDataSyncBackgroundTasksForTests,
  startDataSyncBackgroundTask,
} from './dataSyncBackgroundTask';

const runtimeApi = vi.hoisted(() => {
  const handlers = new Map<string, (event: any) => void>();
  return {
    EventsOn: vi.fn((eventName: string, handler: (event: any) => void) => {
      handlers.set(eventName, handler);
      return () => {
        if (handlers.get(eventName) === handler) handlers.delete(eventName);
      };
    }),
    emit: (eventName: string, event: any) => handlers.get(eventName)?.(event),
    clear: () => handlers.clear(),
  };
});

vi.mock('../../wailsjs/runtime/runtime', () => runtimeApi);

describe('dataSyncBackgroundTask', () => {
  beforeEach(() => {
    runtimeApi.clear();
    runtimeApi.EventsOn.mockClear();
    resetDataSyncBackgroundTasksForTests();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    resetDataSyncBackgroundTasksForTests();
    vi.restoreAllMocks();
  });

  it('keeps progress and logs outside the initiating component lifecycle', () => {
    startDataSyncBackgroundTask({
      taskKey: 'data-sync-workbench-sync',
      jobId: 'sync-1',
      total: 3,
      stage: '准备中',
    });

    runtimeApi.emit('sync:progress', {
      jobId: 'sync-1',
      percent: 34,
      current: 1,
      total: 3,
      table: 'orders',
      stage: '同步 orders',
    });
    runtimeApi.emit('sync:log', {
      jobId: 'sync-1',
      level: 'info',
      message: '已完成 orders',
      ts: 1_100,
    });

    const running = getDataSyncBackgroundTask('data-sync-workbench-sync');
    expect(running.status).toBe('running');
    expect(running.progress).toMatchObject({ percent: 34, current: 1, total: 3, table: 'orders' });
    expect(running.logs).toEqual([
      { level: 'info', message: '已完成 orders', ts: 1_100 },
    ]);

    vi.mocked(Date.now).mockReturnValue(2_000);
    finishDataSyncBackgroundTask('data-sync-workbench-sync', 'sync-1', {
      success: true,
      tablesSynced: 3,
    });

    const done = getDataSyncBackgroundTask('data-sync-workbench-sync');
    expect(done.status).toBe('done');
    expect(done.finishedAt).toBe(2_000);
    expect(done.progress).toMatchObject({ percent: 100, current: 3, total: 3 });
  });

  it('routes concurrent sync events by job id', () => {
    startDataSyncBackgroundTask({ taskKey: 'sync-a', jobId: 'job-a', total: 2, stage: 'a' });
    startDataSyncBackgroundTask({ taskKey: 'sync-b', jobId: 'job-b', total: 4, stage: 'b' });

    runtimeApi.emit('sync:progress', { jobId: 'job-b', current: 2, total: 4, percent: 50 });
    runtimeApi.emit('sync:log', { jobId: 'job-a', message: 'only-a' });

    expect(getDataSyncBackgroundTask('sync-a').progress.current).toBe(0);
    expect(getDataSyncBackgroundTask('sync-a').logs[0]?.message).toBe('only-a');
    expect(getDataSyncBackgroundTask('sync-b').progress.current).toBe(2);
    expect(getDataSyncBackgroundTask('sync-b').logs).toEqual([]);
  });

  it('uses returned backend logs when no realtime log event arrived', () => {
    startDataSyncBackgroundTask({ taskKey: 'sync-a', jobId: 'job-a', total: 1, stage: 'a' });
    finishDataSyncBackgroundTask('sync-a', 'job-a', {
      success: false,
      logs: ['警告：跳过无主键表', '失败：写入异常'],
    });

    expect(getDataSyncBackgroundTask('sync-a').status).toBe('error');
    expect(getDataSyncBackgroundTask('sync-a').logs.map((item) => item.level)).toEqual(['warn', 'error']);
  });

  it('rejects duplicate starts and ignores a stale completion', () => {
    expect(startDataSyncBackgroundTask({
      taskKey: 'sync-a',
      jobId: 'job-a',
      total: 2,
      stage: 'first',
    })).toBe(true);
    expect(startDataSyncBackgroundTask({
      taskKey: 'sync-a',
      jobId: 'job-b',
      total: 3,
      stage: 'second',
    })).toBe(false);

    finishDataSyncBackgroundTask('sync-a', 'job-b', { success: true });
    expect(getDataSyncBackgroundTask('sync-a')).toMatchObject({
      jobId: 'job-a',
      status: 'running',
    });

    finishDataSyncBackgroundTask('sync-a', 'job-a', { success: true });
    expect(getDataSyncBackgroundTask('sync-a').status).toBe('done');
  });
});
