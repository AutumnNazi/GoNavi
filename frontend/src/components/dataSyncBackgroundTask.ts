import { create } from 'zustand';

import { EventsOn } from '../../wailsjs/runtime/runtime';

export type DataSyncTaskStatus = 'idle' | 'running' | 'done' | 'error';

export type DataSyncTaskLogItem = {
  level: string;
  message: string;
  ts?: number;
};

export type DataSyncTaskProgress = {
  percent: number;
  current: number;
  total: number;
  table: string;
  stage: string;
};

export type DataSyncBackgroundTask = {
  taskKey: string;
  jobId: string;
  status: DataSyncTaskStatus;
  startedAt: number;
  finishedAt: number;
  progress: DataSyncTaskProgress;
  logs: DataSyncTaskLogItem[];
  result: any;
};

type SyncLogEvent = {
  jobId?: string;
  level?: string;
  message?: string;
  ts?: number;
};

type SyncProgressEvent = {
  jobId?: string;
  percent?: number;
  current?: number;
  total?: number;
  table?: string;
  stage?: string;
};

type StartDataSyncTaskInput = {
  taskKey: string;
  jobId: string;
  total: number;
  stage: string;
};

type DataSyncTaskStore = {
  tasks: Record<string, DataSyncBackgroundTask>;
  jobTaskKeys: Record<string, string>;
  startTask: (input: StartDataSyncTaskInput) => boolean;
  finishTask: (taskKey: string, jobId: string, result: any) => void;
  failTask: (taskKey: string, jobId: string, result: any) => void;
  appendLog: (event: SyncLogEvent) => void;
  updateProgress: (event: SyncProgressEvent) => void;
  clearTask: (taskKey: string) => void;
  resetAll: () => void;
};

const MAX_SYNC_TASK_LOGS = 2_000;
const SYNC_ERROR_LOG_MARKERS = ['致命错误', '失败']; // i18n-scan: allow-raw backend log severity markers
const SYNC_WARNING_LOG_MARKERS = ['跳过', '警告']; // i18n-scan: allow-raw backend log severity markers

export const EMPTY_DATA_SYNC_PROGRESS: DataSyncTaskProgress = Object.freeze({
  percent: 0,
  current: 0,
  total: 0,
  table: '',
  stage: '',
});

export const EMPTY_DATA_SYNC_BACKGROUND_TASK: DataSyncBackgroundTask = Object.freeze({
  taskKey: '',
  jobId: '',
  status: 'idle',
  startedAt: 0,
  finishedAt: 0,
  progress: EMPTY_DATA_SYNC_PROGRESS,
  logs: [],
  result: null,
});

const normalizeCount = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return Math.trunc(next);
};

const normalizePercent = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(100, next));
};

export const resolveDataSyncTaskLogLevel = (message: string): 'error' | 'warn' | 'info' => (
  SYNC_ERROR_LOG_MARKERS.some((marker) => message.includes(marker))
    ? 'error'
    : SYNC_WARNING_LOG_MARKERS.some((marker) => message.includes(marker))
      ? 'warn'
      : 'info'
);

const normalizeResultLogs = (result: any): DataSyncTaskLogItem[] => {
  if (!Array.isArray(result?.logs)) return [];
  return result.logs
    .map((raw: unknown) => String(raw || '').trim())
    .filter(Boolean)
    .map((message: string) => ({
      level: resolveDataSyncTaskLogLevel(message),
      message,
    }));
};

let stopLogListener: (() => void) | null = null;
let stopProgressListener: (() => void) | null = null;

const stopEventBridge = () => {
  stopLogListener?.();
  stopProgressListener?.();
  stopLogListener = null;
  stopProgressListener = null;
};

const useDataSyncTaskStore = create<DataSyncTaskStore>((set, get) => ({
  tasks: {},
  jobTaskKeys: {},
  startTask: ({ taskKey, jobId, total, stage }) => {
    const normalizedTaskKey = String(taskKey || '').trim();
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedTaskKey || !normalizedJobId) return false;
    ensureDataSyncEventBridge();
    if (get().tasks[normalizedTaskKey]?.status === 'running') return false;
    set((state) => {
      const jobTaskKeys = { ...state.jobTaskKeys };
      const previousJobId = state.tasks[normalizedTaskKey]?.jobId;
      if (previousJobId) delete jobTaskKeys[previousJobId];
      jobTaskKeys[normalizedJobId] = normalizedTaskKey;
      return {
        tasks: {
          ...state.tasks,
          [normalizedTaskKey]: {
            taskKey: normalizedTaskKey,
            jobId: normalizedJobId,
            status: 'running',
            startedAt: Date.now(),
            finishedAt: 0,
            progress: {
              ...EMPTY_DATA_SYNC_PROGRESS,
              total: normalizeCount(total),
              stage: String(stage || '').trim(),
            },
            logs: [],
            result: null,
          },
        },
        jobTaskKeys,
      };
    });
    return true;
  },
  finishTask: (taskKey, jobId, result) => {
    const normalizedTaskKey = String(taskKey || '').trim();
    const normalizedJobId = String(jobId || '').trim();
    set((state) => {
      const current = state.tasks[normalizedTaskKey];
      if (!current || current.jobId !== normalizedJobId) return state;
      const fallbackLogs = current.logs.length === 0 ? normalizeResultLogs(result) : current.logs;
      const succeeded = result?.success === true;
      const jobTaskKeys = { ...state.jobTaskKeys };
      delete jobTaskKeys[current.jobId];
      return {
        tasks: {
          ...state.tasks,
          [normalizedTaskKey]: {
            ...current,
            status: succeeded ? 'done' : 'error',
            finishedAt: Date.now(),
            progress: {
              ...current.progress,
              percent: succeeded ? 100 : current.progress.percent,
              current: succeeded
                ? Math.max(current.progress.current, current.progress.total)
                : current.progress.current,
            },
            logs: fallbackLogs.slice(-MAX_SYNC_TASK_LOGS),
            result,
          },
        },
        jobTaskKeys,
      };
    });
  },
  failTask: (taskKey, jobId, result) => {
    const normalizedTaskKey = String(taskKey || '').trim();
    const normalizedJobId = String(jobId || '').trim();
    set((state) => {
      const current = state.tasks[normalizedTaskKey];
      if (!current || current.jobId !== normalizedJobId) return state;
      const jobTaskKeys = { ...state.jobTaskKeys };
      delete jobTaskKeys[current.jobId];
      return {
        tasks: {
          ...state.tasks,
          [normalizedTaskKey]: {
            ...current,
            status: 'error',
            finishedAt: Date.now(),
            result,
          },
        },
        jobTaskKeys,
      };
    });
  },
  appendLog: (event) => {
    const jobId = String(event?.jobId || '').trim();
    const message = String(event?.message || '').trim();
    const taskKey = get().jobTaskKeys[jobId];
    if (!taskKey || !message) return;
    set((state) => {
      const current = state.tasks[taskKey];
      if (!current || current.jobId !== jobId) return state;
      return {
        tasks: {
          ...state.tasks,
          [taskKey]: {
            ...current,
            logs: [
              ...current.logs,
              {
                level: String(event.level || 'info'),
                message,
                ts: typeof event.ts === 'number' ? event.ts : undefined,
              },
            ].slice(-MAX_SYNC_TASK_LOGS),
          },
        },
      };
    });
  },
  updateProgress: (event) => {
    const jobId = String(event?.jobId || '').trim();
    const taskKey = get().jobTaskKeys[jobId];
    if (!taskKey) return;
    set((state) => {
      const current = state.tasks[taskKey];
      if (!current || current.jobId !== jobId) return state;
      return {
        tasks: {
          ...state.tasks,
          [taskKey]: {
            ...current,
            progress: {
              percent: typeof event.percent === 'number'
                ? normalizePercent(event.percent, current.progress.percent)
                : current.progress.percent,
              current: typeof event.current === 'number'
                ? normalizeCount(event.current, current.progress.current)
                : current.progress.current,
              total: typeof event.total === 'number'
                ? normalizeCount(event.total, current.progress.total)
                : current.progress.total,
              table: typeof event.table === 'string' ? event.table : current.progress.table,
              stage: typeof event.stage === 'string' ? event.stage : current.progress.stage,
            },
          },
        },
      };
    });
  },
  clearTask: (taskKey) => {
    const normalizedTaskKey = String(taskKey || '').trim();
    set((state) => {
      const current = state.tasks[normalizedTaskKey];
      if (!current || current.status === 'running') return state;
      const tasks = { ...state.tasks };
      const jobTaskKeys = { ...state.jobTaskKeys };
      delete tasks[normalizedTaskKey];
      delete jobTaskKeys[current.jobId];
      return { tasks, jobTaskKeys };
    });
  },
  resetAll: () => set({ tasks: {}, jobTaskKeys: {} }),
}));

const ensureDataSyncEventBridge = () => {
  if (stopLogListener || stopProgressListener) return;
  stopLogListener = EventsOn('sync:log', (event: SyncLogEvent) => {
    useDataSyncTaskStore.getState().appendLog(event);
  });
  stopProgressListener = EventsOn('sync:progress', (event: SyncProgressEvent) => {
    useDataSyncTaskStore.getState().updateProgress(event);
  });
};

export const useDataSyncBackgroundTask = (taskKey: string): DataSyncBackgroundTask =>
  useDataSyncTaskStore((state) => state.tasks[String(taskKey || '').trim()] || EMPTY_DATA_SYNC_BACKGROUND_TASK);

export const startDataSyncBackgroundTask = (input: StartDataSyncTaskInput) =>
  useDataSyncTaskStore.getState().startTask(input);

export const finishDataSyncBackgroundTask = (taskKey: string, jobId: string, result: any) =>
  useDataSyncTaskStore.getState().finishTask(taskKey, jobId, result);

export const failDataSyncBackgroundTask = (taskKey: string, jobId: string, result: any) =>
  useDataSyncTaskStore.getState().failTask(taskKey, jobId, result);

export const clearDataSyncBackgroundTask = (taskKey: string) =>
  useDataSyncTaskStore.getState().clearTask(taskKey);

export const getDataSyncBackgroundTask = (taskKey: string): DataSyncBackgroundTask =>
  useDataSyncTaskStore.getState().tasks[String(taskKey || '').trim()] || EMPTY_DATA_SYNC_BACKGROUND_TASK;

export const resetDataSyncBackgroundTasksForTests = () => {
  stopEventBridge();
  useDataSyncTaskStore.getState().resetAll();
};
