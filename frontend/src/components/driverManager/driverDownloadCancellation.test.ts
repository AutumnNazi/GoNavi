import { describe, expect, it, vi } from 'vitest';

import type { DriverProgressState } from '../../utils/driverProgress';
import {
  canCancelDriverDownload,
  createDriverBatchCancellation,
  createDriverDownloadCancelIntents,
  createDriverInstallSessions,
  extractDriverDownloadTaskSnapshots,
  listActiveDriverDownloadCancelTargets,
  nextDriverActionStateAfterCancel,
  normalizeDriverDownloadTaskSnapshot,
  resolveDriverDownloadCancelTarget,
  shouldAbortDriverInstall,
  shouldIgnoreDriverDownloadProgress,
  waitForDriverDownloadTask,
} from './driverDownloadCancellation';

const progress = (status: DriverProgressState['status'], percent = 0): DriverProgressState => ({
  status,
  message: '',
  percent,
});

describe('normalizeDriverDownloadTaskSnapshot', () => {
  it('accepts canceled tasks from the backend snapshot', () => {
    const task = normalizeDriverDownloadTaskSnapshot({
      taskId: 'task-1',
      driverType: 'DuckDB',
      status: 'canceled',
      percent: 42,
      running: false,
      message: '已取消下载',
    });

    expect(task).toMatchObject({
      taskId: 'task-1',
      driverType: 'duckdb',
      status: 'canceled',
      percent: 42,
      running: false,
    });
  });

  it('marks tasks that stopped without a terminal status as errors', () => {
    expect(normalizeDriverDownloadTaskSnapshot({
      taskId: 'task-2',
      driverType: 'duckdb',
      status: 'downloading',
      running: false,
    })?.status).toBe('error');
    expect(normalizeDriverDownloadTaskSnapshot({ taskId: '', driverType: 'duckdb', status: 'done' })).toBeNull();
    expect(normalizeDriverDownloadTaskSnapshot({ taskId: 'x', driverType: 'duckdb', status: 'paused' })).toBeNull();
  });

  it('extracts snapshots from both array and wrapped payloads', () => {
    const raw = [{ taskId: 'a', driverType: 'duckdb', status: 'done' }, { bogus: true }];
    expect(extractDriverDownloadTaskSnapshots(raw)).toHaveLength(1);
    expect(extractDriverDownloadTaskSnapshots({ tasks: raw })).toHaveLength(1);
    expect(extractDriverDownloadTaskSnapshots(null)).toEqual([]);
  });
});

describe('resolveDriverDownloadCancelTarget', () => {
  const taskIdMap = { duckdb: 'task-duckdb', mongodb: 'task-mongodb', oracle: 'task-oracle' };
  const progressMap: Record<string, DriverProgressState> = {
    duckdb: progress('downloading', 30),
    mongodb: progress('done', 100),
    oracle: progress('start'),
  };

  it('lets the user cancel as soon as the card shows an active install', () => {
    expect(canCancelDriverDownload(progressMap, 'DuckDB')).toBe(true);
    expect(canCancelDriverDownload(progressMap, 'oracle')).toBe(true);
    expect(canCancelDriverDownload(progressMap, 'mongodb')).toBe(false);
    expect(resolveDriverDownloadCancelTarget(taskIdMap, progressMap, 'DuckDB')).toBe('task-duckdb');
    expect(resolveDriverDownloadCancelTarget(taskIdMap, progressMap, 'mongodb')).toBe('');
    expect(resolveDriverDownloadCancelTarget(taskIdMap, progressMap, 'postgres')).toBe('');
    expect(resolveDriverDownloadCancelTarget({}, progressMap, 'duckdb')).toBe('');
  });

  it('lists every active install for cancel all, including local phases without a task id', () => {
    expect(listActiveDriverDownloadCancelTargets(taskIdMap, progressMap)).toEqual([
      { driverType: 'duckdb', taskId: 'task-duckdb' },
      { driverType: 'oracle', taskId: 'task-oracle' },
    ]);
    expect(listActiveDriverDownloadCancelTargets({}, progressMap)).toEqual([
      { driverType: 'duckdb', taskId: '' },
      { driverType: 'oracle', taskId: '' },
    ]);
  });
});

describe('driver download cancel intents', () => {
  it('aborts an install the moment the user clicks cancel, even before a backend task exists', () => {
    const intents = createDriverDownloadCancelIntents();
    expect(shouldAbortDriverInstall('iotdb', intents.isRequested, false)).toBe(false);
    intents.request('IoTDB');
    expect(intents.isRequested('iotdb')).toBe(true);
    expect(shouldAbortDriverInstall('iotdb', intents.isRequested, false)).toBe(true);
    expect(shouldIgnoreDriverDownloadProgress('downloading', true)).toBe(true);
    expect(shouldIgnoreDriverDownloadProgress('canceled', true)).toBe(false);
    expect(shouldAbortDriverInstall('clickhouse', intents.isRequested, true)).toBe(true);
    intents.clear('iotdb');
    expect(shouldAbortDriverInstall('iotdb', intents.isRequested, false)).toBe(false);
  });
});

describe('createDriverInstallSessions', () => {
  it('invalidates an in-flight install so a later cancel can release the action button', () => {
    const sessions = createDriverInstallSessions();
    const session = sessions.begin('IoTDB');
    expect(sessions.isCurrent('iotdb', session)).toBe(true);
    sessions.begin('iotdb');
    expect(sessions.isCurrent('iotdb', session)).toBe(false);
    expect(sessions.isCurrent('clickhouse', session)).toBe(false);
  });

  it('clears a spinning install action only for the canceled driver', () => {
    expect(nextDriverActionStateAfterCancel({ driverType: 'iotdb', kind: 'install' }, 'IoTDB')).toEqual({
      driverType: '',
      kind: '',
    });
    expect(nextDriverActionStateAfterCancel({ driverType: 'clickhouse', kind: 'install' }, 'iotdb')).toEqual({
      driverType: 'clickhouse',
      kind: 'install',
    });
  });
});

describe('createDriverBatchCancellation', () => {
  it('remembers a cancel-all request until the next batch resets it', () => {
    const cancellation = createDriverBatchCancellation();
    expect(cancellation.isRequested()).toBe(false);
    cancellation.request();
    expect(cancellation.isRequested()).toBe(true);
    cancellation.reset();
    expect(cancellation.isRequested()).toBe(false);
  });
});

describe('waitForDriverDownloadTask', () => {
  const sleep = () => Promise.resolve();

  it('polls the task list until the task stops running and reports each snapshot', async () => {
    const listTasks = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [{ taskId: 't1', driverType: 'duckdb', status: 'downloading', percent: 20, running: true }] })
      .mockResolvedValueOnce({ success: true, data: { tasks: [{ taskId: 't1', driverType: 'duckdb', status: 'downloading', percent: 80, running: true }] } })
      .mockResolvedValueOnce({ success: true, data: [{ taskId: 't1', driverType: 'duckdb', status: 'canceled', percent: 80, running: false }] });
    const onSnapshot = vi.fn();

    const finished = await waitForDriverDownloadTask('t1', { listTasks, onSnapshot, sleep });

    expect(finished?.status).toBe('canceled');
    expect(finished?.running).toBe(false);
    expect(listTasks).toHaveBeenCalledTimes(3);
    expect(onSnapshot).toHaveBeenCalledTimes(3);
    expect(onSnapshot.mock.calls.map(([task]) => task.percent)).toEqual([20, 80, 80]);
  });

  it('gives up when the task disappears from the backend list', async () => {
    const listTasks = vi.fn().mockResolvedValue({ success: true, data: [] });

    const finished = await waitForDriverDownloadTask('missing', { listTasks, sleep, maxMissingPolls: 2 });

    expect(finished).toBeNull();
    expect(listTasks).toHaveBeenCalledTimes(2);
  });

  it('tolerates transient list failures before giving up', async () => {
    const listTasks = vi.fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: [{ taskId: 't2', driverType: 'duckdb', status: 'done', percent: 100, running: false }] });

    const finished = await waitForDriverDownloadTask('t2', { listTasks, sleep, maxFailedPolls: 5 });

    expect(finished?.status).toBe('done');
    expect(listTasks).toHaveBeenCalledTimes(3);
  });

  it('returns null for an empty task id without polling', async () => {
    const listTasks = vi.fn();
    expect(await waitForDriverDownloadTask('  ', { listTasks, sleep })).toBeNull();
    expect(listTasks).not.toHaveBeenCalled();
  });
});
