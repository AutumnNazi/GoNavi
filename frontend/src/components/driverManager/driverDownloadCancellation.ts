import {
  isDriverProgressActiveStatus,
  isDriverProgressStatus,
  isDriverProgressTerminalStatus,
  type DriverProgressState,
  type DriverProgressStatus,
} from '../../utils/driverProgress';

export type DriverDownloadTaskSnapshot = {
  taskId: string;
  driverType: string;
  version?: string;
  downloadDir?: string;
  status: DriverProgressStatus;
  percent: number;
  message?: string;
  running?: boolean;
  startedAt?: string;
  finishedAt?: string;
};

export type DriverDownloadTaskListResult = {
  success?: boolean;
  data?: unknown;
} | null | undefined;

export type DriverDownloadCancelTarget = {
  driverType: string;
  taskId: string;
};

export const normalizeDriverTypeKey = (value: unknown): string => String(value || '').trim().toLowerCase();

export const isDriverDownloadActive = (progress?: DriverProgressState): boolean => (
  isDriverProgressActiveStatus(progress?.status)
);

export const isDriverDownloadTerminal = (progress?: DriverProgressState): boolean => (
  isDriverProgressTerminalStatus(progress?.status)
);

export const normalizeDriverDownloadTaskSnapshot = (value: unknown): DriverDownloadTaskSnapshot | null => {
  const item = (value || {}) as Record<string, unknown>;
  const taskId = String(item.taskId || '').trim();
  const driverType = normalizeDriverTypeKey(item.driverType);
  const rawStatus = String(item.status || '').trim().toLowerCase();
  if (!taskId || !driverType || !isDriverProgressStatus(rawStatus)) {
    return null;
  }
  const running = typeof item.running === 'boolean' ? item.running : undefined;
  // A task that stopped running without reaching a terminal status died
  // unexpectedly (for example, a backend restart); surface it as an error.
  const status: DriverProgressStatus = running === false && isDriverProgressActiveStatus(rawStatus)
    ? 'error'
    : rawStatus;
  return {
    taskId,
    driverType,
    version: String(item.version || '').trim() || undefined,
    downloadDir: String(item.downloadDir || '').trim() || undefined,
    status,
    percent: Math.max(0, Math.min(100, Number(item.percent || 0))),
    message: String(item.message || '').trim() || undefined,
    running,
    startedAt: String(item.startedAt || '').trim() || undefined,
    finishedAt: String(item.finishedAt || '').trim() || undefined,
  };
};

export const extractDriverDownloadTaskSnapshots = (data: unknown): DriverDownloadTaskSnapshot[] => {
  const nested = (data as { tasks?: unknown } | null | undefined)?.tasks;
  const rawTasks: unknown[] = Array.isArray(data)
    ? data
    : (Array.isArray(nested) ? nested : []);
  return rawTasks
    .map(normalizeDriverDownloadTaskSnapshot)
    .filter((task): task is DriverDownloadTaskSnapshot => !!task);
};

export const isDriverDownloadTaskFinished = (task: DriverDownloadTaskSnapshot): boolean => (
  task.running === false || isDriverProgressTerminalStatus(task.status)
);

/**
 * Resolves the backend task ID for a cancel click. An empty string means the
 * UI is already in a cancelable local phase (version lookup / starting) and
 * the install loop must abort without waiting for the backend.
 */
export const resolveDriverDownloadCancelTarget = (
  taskIdMap: Record<string, string>,
  progressMap: Record<string, DriverProgressState>,
  driverType: string,
): string => {
  const normalized = normalizeDriverTypeKey(driverType);
  if (!normalized || !isDriverDownloadActive(progressMap[normalized])) {
    return '';
  }
  return String(taskIdMap[normalized] || '').trim();
};

export const canCancelDriverDownload = (
  progressMap: Record<string, DriverProgressState>,
  driverType: string,
): boolean => isDriverDownloadActive(progressMap[normalizeDriverTypeKey(driverType)]);

export const listActiveDriverDownloadCancelTargets = (
  taskIdMap: Record<string, string>,
  progressMap: Record<string, DriverProgressState>,
): DriverDownloadCancelTarget[] => {
  const driverTypes = new Set([
    ...Object.keys(taskIdMap),
    ...Object.keys(progressMap),
  ]);
  return [...driverTypes]
    .map((driverType) => {
      const normalized = normalizeDriverTypeKey(driverType);
      if (!normalized || !isDriverDownloadActive(progressMap[normalized])) {
        return null;
      }
      return {
        driverType: normalized,
        taskId: String(taskIdMap[normalized] || '').trim(),
      };
    })
    .filter((target): target is DriverDownloadCancelTarget => !!target);
};

export type DriverBatchCancellation = {
  request: () => void;
  isRequested: () => boolean;
  reset: () => void;
};

/**
 * Tracks a "cancel all" request for a sequential batch. The batch loop checks
 * `isRequested()` before starting the next driver so queued items never reach
 * the backend once the user asked to stop.
 */
export const createDriverBatchCancellation = (): DriverBatchCancellation => {
  let requested = false;
  return {
    request: () => {
      requested = true;
    },
    isRequested: () => requested,
    reset: () => {
      requested = false;
    },
  };
};

export type DriverDownloadCancelIntents = {
  request: (driverType: string) => void;
  isRequested: (driverType: string) => boolean;
  clear: (driverType: string) => void;
};

/** Per-driver cancel flag so a click during version lookup still aborts the install. */
export const createDriverDownloadCancelIntents = (): DriverDownloadCancelIntents => {
  const requested = new Set<string>();
  return {
    request: (driverType: string) => {
      const normalized = normalizeDriverTypeKey(driverType);
      if (normalized) {
        requested.add(normalized);
      }
    },
    isRequested: (driverType: string) => requested.has(normalizeDriverTypeKey(driverType)),
    clear: (driverType: string) => {
      requested.delete(normalizeDriverTypeKey(driverType));
    },
  };
};

export type DriverInstallSessions = {
  begin: (driverType: string) => number;
  isCurrent: (driverType: string, session: number) => boolean;
};

/** Monotonic per-driver token so a canceled install cannot keep the action button spinning. */
export const createDriverInstallSessions = (): DriverInstallSessions => {
  const sessions = new Map<string, number>();
  return {
    begin: (driverType: string) => {
      const normalized = normalizeDriverTypeKey(driverType);
      const next = (sessions.get(normalized) || 0) + 1;
      if (normalized) {
        sessions.set(normalized, next);
      }
      return next;
    },
    isCurrent: (driverType: string, session: number) => (
      sessions.get(normalizeDriverTypeKey(driverType)) === session
    ),
  };
};

export const shouldAbortDriverInstall = (
  driverType: string,
  cancelRequested: (driverType: string) => boolean,
  batchCancelRequested: boolean,
): boolean => batchCancelRequested || cancelRequested(driverType);

export const nextDriverActionStateAfterCancel = <T extends { driverType: string; kind: string }>(
  prev: T,
  driverType: string,
): T => (
  String(prev.driverType || '').trim().toLowerCase() === normalizeDriverTypeKey(driverType) && prev.kind === 'install'
    ? { ...prev, driverType: '', kind: '' }
    : prev
);

export const shouldIgnoreDriverDownloadProgress = (
  incomingStatus: DriverProgressStatus,
  cancelRequested: boolean,
): boolean => cancelRequested && incomingStatus !== 'canceled';

export type WaitForDriverDownloadTaskOptions = {
  listTasks: () => Promise<DriverDownloadTaskListResult>;
  onSnapshot?: (task: DriverDownloadTaskSnapshot) => void;
  pollIntervalMs?: number;
  /** Consecutive polls without the task before giving up (backend pruned it). */
  maxMissingPolls?: number;
  /** Consecutive failed list calls before giving up (backend unavailable). */
  maxFailedPolls?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Polls the backend task list until the task stops running. Events are only a
 * hint; the task list is the source of truth, so a batch never hangs when an
 * event is lost or arrives before the listener is attached.
 */
export const waitForDriverDownloadTask = async (
  taskId: string,
  options: WaitForDriverDownloadTaskOptions,
): Promise<DriverDownloadTaskSnapshot | null> => {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) {
    return null;
  }
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs ?? 400));
  const maxMissingPolls = Math.max(1, Number(options.maxMissingPolls ?? 3));
  const maxFailedPolls = Math.max(1, Number(options.maxFailedPolls ?? 15));
  const sleep = options.sleep ?? defaultSleep;
  let missingPolls = 0;
  let failedPolls = 0;
  for (;;) {
    let listed: DriverDownloadTaskListResult = null;
    try {
      listed = await options.listTasks();
    } catch {
      listed = null;
    }
    if (!listed?.success) {
      failedPolls += 1;
      if (failedPolls >= maxFailedPolls) {
        return null;
      }
    } else {
      failedPolls = 0;
      const task = extractDriverDownloadTaskSnapshots(listed.data).find((item) => item.taskId === normalizedTaskId);
      if (task) {
        missingPolls = 0;
        options.onSnapshot?.(task);
        if (isDriverDownloadTaskFinished(task)) {
          return task;
        }
      } else {
        missingPolls += 1;
        if (missingPolls >= maxMissingPolls) {
          return null;
        }
      }
    }
    await sleep(pollIntervalMs);
  }
};
