import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { ExportProgressStatus } from '../utils/exportProgress';

export type ExportProgressEvent = {
  jobId: string;
  status?: ExportProgressStatus;
  stage?: string;
  current?: number;
  total?: number;
  totalRowsKnown?: boolean;
  format?: string;
  targetName?: string;
  filePath?: string;
  message?: string;
};

export type ExportProgressState = {
  open: boolean;
  jobId: string;
  title: string;
  targetName: string;
  format: string;
  startedAt: number;
  finishedAt: number;
  status: ExportProgressStatus;
  stage: string;
  current: number;
  total: number;
  totalRowsKnown: boolean;
  filePath: string;
  message: string;
  requestKey?: string;
};

export type ExportProgressLogEntry = {
  sequence: number;
  timestamp: number;
  jobId: string;
  source: 'client' | 'backend' | 'result';
  status: ExportProgressStatus;
  stage: string;
  current: number;
  total: number;
  totalRowsKnown: boolean;
  filePath: string;
  message: string;
};

export type ExportProgressTaskSnapshot = {
  state: ExportProgressState;
  logs: ExportProgressLogEntry[];
};

type ExportProgressTaskRecord = {
  snapshot: ExportProgressTaskSnapshot;
  listeners: Set<() => void>;
  retainAfterUnmount: boolean;
  nextLogSequence: number;
  lastAccessSequence: number;
};

export const EXPORT_PROGRESS_TASK_LOG_LIMIT = 200;
export const EXPORT_PROGRESS_RETAINED_TASK_LIMIT = 100;

const taskRecords = new Map<string, ExportProgressTaskRecord>();
const taskKeyByJobId = new Map<string, string>();

let runtimeListenerOff: (() => void) | null = null;
let ephemeralTaskSequence = 0;
let taskAccessSequence = 0;

export const createInitialExportProgressState = (): ExportProgressState => ({
  open: false,
  jobId: '',
  title: '',
  targetName: '',
  format: '',
  startedAt: 0,
  finishedAt: 0,
  status: 'idle',
  stage: '',
  current: 0,
  total: 0,
  totalRowsKnown: false,
  filePath: '',
  message: '',
  requestKey: '',
});

export const createEphemeralExportProgressTaskKey = (): string => {
  ephemeralTaskSequence += 1;
  return `__export-progress-ephemeral-${ephemeralTaskSequence}`;
};

const normalizeTaskKey = (taskKey: string): string => String(taskKey || '').trim();

const normalizeCount = (value: unknown): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    return 0;
  }
  return Math.trunc(next);
};

const hasUsableTotalRows = (known: boolean, total: unknown): boolean => {
  if (!known) {
    return false;
  }
  return normalizeCount(total) > 0;
};

const isActiveExportStatus = (status: ExportProgressStatus): boolean =>
  status === 'start' || status === 'running' || status === 'finalizing';

const isTerminalExportStatus = (status: ExportProgressStatus): boolean =>
  status === 'done' || status === 'error';

const touchTaskRecord = (record: ExportProgressTaskRecord) => {
  taskAccessSequence += 1;
  record.lastAccessSequence = taskAccessSequence;
};

const pruneRetainedTaskRecords = () => {
  const retainedEntries = [...taskRecords.entries()]
    .filter(([, record]) => record.retainAfterUnmount);
  let overflow = retainedEntries.length - EXPORT_PROGRESS_RETAINED_TASK_LIMIT;
  if (overflow <= 0) return;
  const candidates = retainedEntries
    .filter(([, record]) => (
      record.listeners.size === 0
      && !isActiveExportStatus(record.snapshot.state.status)
      && (!record.snapshot.state.jobId || !taskKeyByJobId.has(record.snapshot.state.jobId))
    ))
    .sort((a, b) => a[1].lastAccessSequence - b[1].lastAccessSequence);
  for (const [taskKey] of candidates) {
    if (overflow <= 0) break;
    taskRecords.delete(taskKey);
    overflow -= 1;
  }
};

const getOrCreateTaskRecord = (
  taskKey: string,
  retainAfterUnmount = false,
): ExportProgressTaskRecord => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const existing = taskRecords.get(normalizedTaskKey);
  if (existing) {
    if (retainAfterUnmount) {
      existing.retainAfterUnmount = true;
    }
    touchTaskRecord(existing);
    return existing;
  }

  const record: ExportProgressTaskRecord = {
    snapshot: {
      state: createInitialExportProgressState(),
      logs: [],
    },
    listeners: new Set(),
    retainAfterUnmount,
    nextLogSequence: 1,
    lastAccessSequence: 0,
  };
  touchTaskRecord(record);
  taskRecords.set(normalizedTaskKey, record);
  pruneRetainedTaskRecords();
  return record;
};

const notifyTaskListeners = (record: ExportProgressTaskRecord) => {
  record.listeners.forEach((listener) => listener());
};

const buildLogEntry = (
  record: ExportProgressTaskRecord,
  state: ExportProgressState,
  source: ExportProgressLogEntry['source'],
): ExportProgressLogEntry => {
  const entry: ExportProgressLogEntry = {
    sequence: record.nextLogSequence,
    timestamp: Date.now(),
    jobId: state.jobId,
    source,
    status: state.status,
    stage: state.stage,
    current: state.current,
    total: state.total,
    totalRowsKnown: state.totalRowsKnown,
    filePath: state.filePath,
    message: state.message,
  };
  record.nextLogSequence += 1;
  return entry;
};

const publishTaskState = (
  record: ExportProgressTaskRecord,
  state: ExportProgressState,
  source?: ExportProgressLogEntry['source'],
) => {
  touchTaskRecord(record);
  const logs = source
    ? [...record.snapshot.logs, buildLogEntry(record, state, source)].slice(-EXPORT_PROGRESS_TASK_LOG_LIMIT)
    : record.snapshot.logs;
  record.snapshot = { state, logs };
  notifyTaskListeners(record);
};

const hasTaskSubscribers = (): boolean => {
  for (const record of taskRecords.values()) {
    if (record.listeners.size > 0) {
      return true;
    }
  }
  return false;
};

const deleteUnusedEphemeralTask = (taskKey: string) => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const record = taskRecords.get(normalizedTaskKey);
  if (!record || record.retainAfterUnmount || record.listeners.size > 0) {
    return;
  }
  if (record.snapshot.state.jobId && taskKeyByJobId.has(record.snapshot.state.jobId)) {
    return;
  }
  taskRecords.delete(normalizedTaskKey);
};

const maybeStopRuntimeListener = () => {
  if (!runtimeListenerOff || taskKeyByJobId.size > 0 || hasTaskSubscribers()) {
    return;
  }
  const off = runtimeListenerOff;
  runtimeListenerOff = null;
  off();
};

const releaseJob = (taskKey: string, jobId: string) => {
  if (taskKeyByJobId.get(jobId) === taskKey) {
    taskKeyByJobId.delete(jobId);
  }
  deleteUnusedEphemeralTask(taskKey);
  pruneRetainedTaskRecords();
  maybeStopRuntimeListener();
};

const applyBackendProgress = (event: ExportProgressEvent) => {
  const jobId = String(event?.jobId || '').trim();
  const taskKey = taskKeyByJobId.get(jobId);
  if (!taskKey) {
    return;
  }
  const record = taskRecords.get(taskKey);
  if (!record || record.snapshot.state.jobId !== jobId) {
    return;
  }

  const prev = record.snapshot.state;
  const nextStatus = (event.status || prev.status || 'running') as ExportProgressStatus;
  const nextStartedAt = prev.startedAt > 0 || nextStatus === 'idle'
    ? prev.startedAt
    : Date.now();
  const rawNextTotal = normalizeCount(typeof event.total === 'number' ? event.total : prev.total);
  const requestedTotalRowsKnown = typeof event.totalRowsKnown === 'boolean'
    ? event.totalRowsKnown
    : prev.totalRowsKnown;
  const nextTotalRowsKnown = hasUsableTotalRows(requestedTotalRowsKnown, rawNextTotal);
  const nextState: ExportProgressState = {
    ...prev,
    open: true,
    startedAt: nextStartedAt,
    status: nextStatus,
    finishedAt: isTerminalExportStatus(nextStatus)
      ? (prev.finishedAt || Date.now())
      : prev.finishedAt,
    stage: typeof event.stage === 'string' && event.stage.trim() ? event.stage.trim() : prev.stage,
    current: normalizeCount(typeof event.current === 'number' ? event.current : prev.current),
    total: nextTotalRowsKnown ? rawNextTotal : 0,
    totalRowsKnown: nextTotalRowsKnown,
    format: typeof event.format === 'string' && event.format.trim()
      ? String(event.format).toUpperCase()
      : prev.format,
    targetName: typeof event.targetName === 'string' && event.targetName.trim()
      ? event.targetName.trim()
      : prev.targetName,
    filePath: typeof event.filePath === 'string' && event.filePath.trim()
      ? event.filePath.trim()
      : prev.filePath,
    message: typeof event.message === 'string' ? event.message : prev.message,
  };
  publishTaskState(record, nextState, 'backend');

  if (isTerminalExportStatus(nextStatus)) {
    releaseJob(taskKey, jobId);
  }
};

const ensureRuntimeListener = () => {
  if (runtimeListenerOff) {
    return;
  }
  runtimeListenerOff = EventsOn('export:progress', applyBackendProgress);
};

export const getExportProgressTaskSnapshot = (
  taskKey: string,
  retainAfterUnmount = false,
): ExportProgressTaskSnapshot => getOrCreateTaskRecord(taskKey, retainAfterUnmount).snapshot;

export const subscribeExportProgressTask = (
  taskKey: string,
  listener: () => void,
  retainAfterUnmount = false,
): (() => void) => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const record = getOrCreateTaskRecord(normalizedTaskKey, retainAfterUnmount);
  record.listeners.add(listener);
  ensureRuntimeListener();

  return () => {
    record.listeners.delete(listener);
    deleteUnusedEphemeralTask(normalizedTaskKey);
    maybeStopRuntimeListener();
  };
};

export const isExportProgressTaskRunning = (taskKey: string): boolean => {
  const status = getOrCreateTaskRecord(taskKey).snapshot.state.status;
  return isActiveExportStatus(status);
};

export const startExportProgressTask = (
  taskKey: string,
  state: ExportProgressState,
  retainAfterUnmount = false,
): boolean => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const record = getOrCreateTaskRecord(normalizedTaskKey, retainAfterUnmount);
  if (isActiveExportStatus(record.snapshot.state.status)) {
    return false;
  }
  const jobId = String(state.jobId || '').trim();
  if (!jobId) {
    return false;
  }
  const previousJobId = record.snapshot.state.jobId;
  if (previousJobId && taskKeyByJobId.get(previousJobId) === normalizedTaskKey) {
    taskKeyByJobId.delete(previousJobId);
  }
  record.snapshot = { ...record.snapshot, logs: [] };
  record.nextLogSequence = 1;
  taskKeyByJobId.set(jobId, normalizedTaskKey);
  ensureRuntimeListener();
  publishTaskState(record, state, 'client');
  return true;
};

export const consumeExportProgressTaskRequest = (
  taskKey: string,
  requestKey: string,
): boolean => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const normalizedRequestKey = String(requestKey || '').trim();
  const record = taskRecords.get(normalizedTaskKey);
  if (
    !record
    || !normalizedRequestKey
    || !isActiveExportStatus(record.snapshot.state.status)
  ) {
    return false;
  }
  if (record.snapshot.state.requestKey === normalizedRequestKey) {
    return true;
  }
  publishTaskState(record, {
    ...record.snapshot.state,
    requestKey: normalizedRequestKey,
  });
  return true;
};

export const finishExportProgressTask = (
  taskKey: string,
  jobId: string,
  update: (state: ExportProgressState) => ExportProgressState,
) => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const record = taskRecords.get(normalizedTaskKey);
  if (!record || record.snapshot.state.jobId !== jobId) {
    return;
  }
  publishTaskState(record, update(record.snapshot.state), 'result');
  releaseJob(normalizedTaskKey, jobId);
};

export const resetExportProgressTask = (taskKey: string) => {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const record = getOrCreateTaskRecord(normalizedTaskKey);
  const jobId = record.snapshot.state.jobId;
  if (jobId && taskKeyByJobId.get(jobId) === normalizedTaskKey) {
    taskKeyByJobId.delete(jobId);
  }
  record.snapshot = { ...record.snapshot, logs: [] };
  record.nextLogSequence = 1;
  publishTaskState(record, createInitialExportProgressState());
  deleteUnusedEphemeralTask(normalizedTaskKey);
  pruneRetainedTaskRecords();
  maybeStopRuntimeListener();
};

export const resetExportProgressTaskStoreForTests = () => {
  if (runtimeListenerOff) {
    runtimeListenerOff();
    runtimeListenerOff = null;
  }
  taskRecords.clear();
  taskKeyByJobId.clear();
  ephemeralTaskSequence = 0;
  taskAccessSequence = 0;
};
