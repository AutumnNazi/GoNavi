import { isLocalDataSyncTaskId } from './wailsDto';
import type {
  DataSyncRunRecord,
  DataSyncRunStatus,
  DataSyncTaskDefinition,
  DataSyncTaskLifecycle,
} from './model';

/**
 * One row of the schedule list. Derived authoritatively from the persisted
 * task definitions; the gateway's own schedule projection only contributes
 * the stable row id and the server-computed nextRunAt.
 */
export type DataSyncScheduleSummary = {
  id: string;
  taskId: string;
  taskName: string;
  /** Persisted task revision backing this row, for stale-row diagnostics. */
  revision?: number;
  lifecycle?: DataSyncTaskLifecycle;
  enabled: boolean;
  expression: string;
  timezone: string;
  nextRunAt: string;
  latestRun?: DataSyncScheduleRunSummary | null;
};

/**
 * The latest-run slice shown inside a schedule row. Only the display-critical
 * fields are kept; the full record stays reachable through the run history.
 */
export type DataSyncScheduleRunSummary = {
  id: string;
  status: DataSyncRunStatus;
  startedAt: string;
  finishedAt: string;
  /**
   * Sanitized, truncated run message. Empty for succeeded runs and runs
   * without a message so the cell never fabricates an error.
   */
  errorSummary: string;
};

/** Upper bound for the sanitized error preview inside the schedule table. */
const SCHEDULE_ERROR_SUMMARY_MAX_LENGTH = 240;

// Non-capturing on purpose: these sources are embedded into larger patterns
// whose own capture groups drive the replacement templates below.
const SENSITIVE_QUERY_KEYS =
  /(?:password|passwd|pwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|app[_-]?secret|secret|api[_-]?key|authorization|credential)/i;

const REDACTED = '[REDACTED]';

/**
 * Display-side defense for run messages rendered inside the schedule list.
 * The backend already redacts authoritative messages; this keeps a leaked
 * credential from reaching the screen when an older backend or a raw driver
 * error slips through. Long messages are truncated after sanitization.
 */
export const summarizeDataSyncRunMessage = (
  message: string,
  maxLength = SCHEDULE_ERROR_SUMMARY_MAX_LENGTH,
): string => {
  let sanitized = message
    // Basic/Bearer authorization headers.
    .replace(/(basic|bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    // URL userinfo: scheme://user:password@host.
    .replace(/([a-z][a-z0-9+.-]*):\/\/([^/@\s]+)@/gi, '$1://[REDACTED]@')
    // Query parameters that carry credentials, including URL-encoded values.
    .replace(
      new RegExp(
        `([?&#]${SENSITIVE_QUERY_KEYS.source}=)[^&\\s"']+`,
        'gi',
      ),
      `$1${REDACTED}`,
    )
    // Quoted JSON-style pairs: "password": "hunter2".
    .replace(
      new RegExp(
        `("${SENSITIVE_QUERY_KEYS.source}"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*(")`,
        'gi',
      ),
      `$1${REDACTED}$2`,
    )
    // Bare key: value fragments inside structured messages.
    .replace(
      new RegExp(
        `\\b(${SENSITIVE_QUERY_KEYS.source})(\\s*[:=]\\s*)("?)[^\\s,"'&;]*\\3`,
        'gi',
      ),
      `$1$2$3${REDACTED}$3`,
    );
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (sanitized.length > maxLength) {
    return `${sanitized.slice(0, maxLength)}…`;
  }
  return sanitized;
};

const scheduleRunTimestamp = (run: DataSyncRunRecord): string =>
  run.startedAt || run.finishedAt || '';

/**
 * Pick the run the schedule row should surface. Ordered by the run's own
 * start timestamp (queued runs already carry their queue time from decode),
 * newest first, with the id as a stable tie-breaker.
 */
export const pickLatestDataSyncScheduleRun = (
  runs: readonly DataSyncRunRecord[],
  taskId: string,
): DataSyncRunRecord | null => {
  let latest: DataSyncRunRecord | null = null;
  for (const run of runs) {
    if (run.taskId !== taskId) continue;
    if (
      !latest ||
      scheduleRunTimestamp(run) > scheduleRunTimestamp(latest) ||
      (scheduleRunTimestamp(run) === scheduleRunTimestamp(latest) &&
        run.id > latest.id)
    ) {
      latest = run;
    }
  }
  return latest;
};

const summarizeScheduleRun = (
  run: DataSyncRunRecord,
): DataSyncScheduleRunSummary => ({
  id: run.id,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  errorSummary:
    run.status !== 'succeeded' && run.message
      ? summarizeDataSyncRunMessage(run.message)
      : '',
});

const scheduleExpression = (task: DataSyncTaskDefinition): string => {
  const trigger = task.trigger;
  if (trigger.mode === 'cron') return trigger.expression;
  if (trigger.mode === 'interval') return `${trigger.intervalSeconds}s`;
  if (trigger.mode === 'once') return trigger.runAt;
  return 'continuous';
};

/**
 * Build the authoritative schedule rows from the persisted task list. Tasks
 * are the source of truth for name/revision/lifecycle; the gateway's schedule
 * rows only contribute their stable id and the server-computed nextRunAt (kept
 * only while the task is enabled). Manual, archived, and local draft tasks
 * never produce rows, so stale projections cannot linger after a lifecycle
 * change.
 */
export const aggregateDataSyncScheduleSummaries = (
  tasks: readonly DataSyncTaskDefinition[],
  runs: readonly DataSyncRunRecord[] = [],
  existing: readonly DataSyncScheduleSummary[] = [],
): DataSyncScheduleSummary[] => {
  const existingByTaskId = new Map(
    existing.map((schedule) => [schedule.taskId, schedule] as const),
  );
  const rows: DataSyncScheduleSummary[] = [];
  for (const task of tasks) {
    if (task.trigger.mode === 'manual') continue;
    if (task.lifecycle === 'archived') continue;
    if (isLocalDataSyncTaskId(task.id)) continue;
    const latestRun = pickLatestDataSyncScheduleRun(runs, task.id);
    rows.push({
      id: existingByTaskId.get(task.id)?.id || `${task.id}:schedule`,
      taskId: task.id,
      taskName: task.name,
      revision: task.revision,
      lifecycle: task.lifecycle,
      enabled: task.lifecycle === 'enabled',
      expression: scheduleExpression(task),
      timezone: task.trigger.mode === 'continuous' ? 'Local' : task.trigger.timezone || 'Local',
      nextRunAt: task.lifecycle === 'enabled'
        ? existingByTaskId.get(task.id)?.nextRunAt || ''
        : '',
      latestRun: latestRun ? summarizeScheduleRun(latestRun) : null,
    });
  }
  return rows;
};
