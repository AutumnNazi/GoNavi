import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';

import { EventsOn } from '../../wailsjs/runtime/runtime';
import { t } from '../i18n';

export type SQLFileExecutionProgressEvent = {
  jobId: string;
  status?: 'running' | 'done' | 'cancelled' | 'error';
  executed?: number;
  failed?: number;
  total?: number;
  percent?: number;
  currentSQL?: string;
  error?: string;
};

export type SQLFileExecutionRunnerStatus =
  | 'idle'
  | 'start'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error';

export type SQLFileExecutionState = {
  jobId: string;
  title: string;
  filePath: string;
  fileSizeMB: string;
  startedAt: number;
  finishedAt: number;
  status: SQLFileExecutionRunnerStatus;
  stage: string;
  executed: number;
  failed: number;
  total: number;
  percent: number;
  currentSQL: string;
  message: string;
};

export type SQLFileExecutionRunResult = {
  success: boolean;
  message: string;
};

export type RunSQLFileExecutionWithProgressOptions<T extends SQLFileExecutionRunResult> = {
  title: string;
  filePath: string;
  fileSizeMB?: string;
  run: (jobId: string) => Promise<T>;
  cancel?: (jobId: string) => void | Promise<void>;
};

type UseSQLFileExecutionRunnerOptions = {
  showToast?: boolean;
};

const createInitialState = (): SQLFileExecutionState => ({
  jobId: '',
  title: '',
  filePath: '',
  fileSizeMB: '',
  startedAt: 0,
  finishedAt: 0,
  status: 'idle',
  stage: '',
  executed: 0,
  failed: 0,
  total: 0,
  percent: 0,
  currentSQL: '',
  message: '',
});

const normalizeCount = (value: unknown): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    return 0;
  }
  return Math.trunc(next);
};

const buildSQLFileExecutionJobId = (): string =>
  `sql-file-execution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const EXECUTION_CANCELED_MESSAGE = '\u5df2\u53d6\u6d88';

export function useSQLFileExecutionRunner(options?: UseSQLFileExecutionRunnerOptions) {
  const showToast = options?.showToast !== false;
  const [state, setState] = useState<SQLFileExecutionState>(() => createInitialState());
  const activeJobIdRef = useRef('');
  const pendingEventRef = useRef<SQLFileExecutionProgressEvent | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const cancelRequestedRef = useRef(false);
  const cancelHandlerRef = useRef<((jobId: string) => void | Promise<void>) | null>(null);

  useEffect(() => {
    const flushPendingEvent = () => {
      flushFrameRef.current = null;
      const event = pendingEventRef.current;
      pendingEventRef.current = null;
      if (!event || String(event.jobId || '') !== activeJobIdRef.current) {
        return;
      }

      setState((prev) => {
        if (prev.jobId !== activeJobIdRef.current) {
          return prev;
        }
        const reportedStatus = (event.status || prev.status || 'running') as SQLFileExecutionRunnerStatus;
        const wasTerminal = prev.status === 'done' || prev.status === 'cancelled' || prev.status === 'error';
        const reportedIsTerminal = reportedStatus === 'done' || reportedStatus === 'cancelled' || reportedStatus === 'error';
        if (wasTerminal && !reportedIsTerminal) {
          return prev;
        }
        // The RPC result is authoritative once it has settled. A terminal
        // progress event delayed by the animation-frame throttle may still
        // contribute final counters/percent, but must not rewrite that result.
        const nextStatus = wasTerminal && reportedIsTerminal ? prev.status : reportedStatus;
        const nextStartedAt = prev.startedAt || Date.now();
        const isTerminal = nextStatus === 'done' || nextStatus === 'cancelled' || nextStatus === 'error';
        const reportedPercent = Math.max(0, Math.min(100, Number(event.percent ?? prev.percent) || 0));
        const nextPercent = reportedStatus === 'done' || nextStatus === 'done'
          ? 100
          : Math.min(99, reportedPercent);
        return {
          ...prev,
          startedAt: nextStartedAt,
          finishedAt: isTerminal ? (prev.finishedAt || Date.now()) : prev.finishedAt,
          status: nextStatus,
          stage: nextStatus === 'cancelled'
            ? t('sidebar.sql_file_exec.status.cancelled')
            : nextStatus === 'error'
              ? t('sidebar.sql_file_exec.status.error')
              : nextStatus === 'done'
                ? t('sidebar.sql_file_exec.status.done')
                : t('sidebar.sql_file_exec.status.running'),
          executed: normalizeCount(event.executed ?? prev.executed),
          failed: normalizeCount(event.failed ?? prev.failed),
          total: normalizeCount(event.total ?? prev.total),
          percent: nextPercent,
          currentSQL: typeof event.currentSQL === 'string' ? event.currentSQL : prev.currentSQL,
          message: typeof event.error === 'string' && event.error.trim() ? event.error : prev.message,
        };
      });
    };

    const scheduleFlush = () => {
      if (flushFrameRef.current !== null) {
        return;
      }
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        flushFrameRef.current = window.requestAnimationFrame(flushPendingEvent);
        return;
      }
      flushFrameRef.current = globalThis.setTimeout(flushPendingEvent, 16) as unknown as number;
    };

    const off = EventsOn('sqlfile:progress', (event: SQLFileExecutionProgressEvent) => {
      if (!event || String(event.jobId || '') !== activeJobIdRef.current) {
        return;
      }
      pendingEventRef.current = event;
      scheduleFlush();
    });

    return () => {
      if (flushFrameRef.current !== null) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(flushFrameRef.current);
        } else {
          globalThis.clearTimeout(flushFrameRef.current);
        }
        flushFrameRef.current = null;
      }
      pendingEventRef.current = null;
      if (typeof off === 'function') {
        off();
      }
    };
  }, []);

  const reset = useCallback(() => {
    activeJobIdRef.current = '';
    pendingEventRef.current = null;
    cancelRequestedRef.current = false;
    cancelHandlerRef.current = null;
    setState(createInitialState());
  }, []);

  const cancelExecution = useCallback(async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId || !cancelHandlerRef.current) {
      return;
    }
    cancelRequestedRef.current = true;
    await cancelHandlerRef.current(jobId);
    setState((prev) => (
      prev.jobId !== jobId
        ? prev
        : {
            ...prev,
            status: 'cancelled',
            stage: t('sidebar.sql_file_exec.status.cancelled'),
          }
    ));
  }, []);

  const runSQLFileExecutionWithProgress = useCallback(async <T extends SQLFileExecutionRunResult,>(
    runOptions: RunSQLFileExecutionWithProgressOptions<T>,
  ): Promise<T | null> => {
    if (state.status === 'start' || state.status === 'running') {
      if (showToast) {
        void message.warning(t('sidebar.sql_file_exec.message.already_running'));
      }
      return null;
    }

    const jobId = buildSQLFileExecutionJobId();
    activeJobIdRef.current = jobId;
    cancelRequestedRef.current = false;
    cancelHandlerRef.current = runOptions.cancel || null;
    setState({
      jobId,
      title: String(runOptions.title || '').trim(),
      filePath: String(runOptions.filePath || '').trim(),
      fileSizeMB: String(runOptions.fileSizeMB || '').trim(),
      startedAt: 0,
      finishedAt: 0,
      status: 'start',
      stage: t('sidebar.sql_file_exec.workbench.stage.preparing'),
      executed: 0,
      failed: 0,
      total: 0,
      percent: 0,
      currentSQL: '',
      message: '',
    });

    try {
      const result = await runOptions.run(jobId);
      setState((prev) => {
        if (prev.jobId !== jobId) {
          return prev;
        }
        const canceled = cancelRequestedRef.current || prev.status === 'cancelled' || result.message === EXECUTION_CANCELED_MESSAGE;
        const nextStatus: SQLFileExecutionRunnerStatus = canceled
          ? 'cancelled'
          : result.success
            ? 'done'
            : 'error';
        return {
          ...prev,
          startedAt: prev.startedAt || Date.now(),
          finishedAt: prev.finishedAt || Date.now(),
          status: nextStatus,
          stage: nextStatus === 'cancelled'
            ? t('sidebar.sql_file_exec.status.cancelled')
            : nextStatus === 'done'
              ? t('sidebar.sql_file_exec.status.done')
              : t('sidebar.sql_file_exec.status.error'),
          percent: nextStatus === 'done' || prev.status === 'done'
            ? 100
            : Math.min(99, prev.percent),
          message: typeof result.message === 'string' ? result.message : prev.message,
        };
      });

      if (showToast) {
        if (cancelRequestedRef.current || result.message === EXECUTION_CANCELED_MESSAGE) {
          void message.info(t('sidebar.sql_file_exec.status.cancelled'));
        } else if (result.success) {
          void message.success(t('sidebar.sql_file_exec.status.done'));
        } else {
          void message.error(result.message || t('sidebar.sql_file_exec.status.error'));
        }
      }
      return result;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      setState((prev) => {
        if (prev.jobId !== jobId) {
          return prev;
        }
        return {
          ...prev,
          startedAt: prev.startedAt || Date.now(),
          finishedAt: prev.finishedAt || Date.now(),
          status: cancelRequestedRef.current ? 'cancelled' : 'error',
          stage: cancelRequestedRef.current
            ? t('sidebar.sql_file_exec.status.cancelled')
            : t('sidebar.sql_file_exec.status.error'),
          message: errorMessage,
        };
      });
      if (showToast) {
        void message.error(errorMessage);
      }
      throw error;
    }
  }, [showToast, state.status]);

  return {
    state,
    reset,
    cancelExecution,
    runSQLFileExecutionWithProgress,
    isRunning: state.status === 'start' || state.status === 'running',
  };
}
