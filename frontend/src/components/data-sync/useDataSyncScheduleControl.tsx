import React, { useCallback, useRef, useState } from 'react';

import Modal from '../common/ResizableDraggableModal';
import type { DataSyncWorkbenchGateway } from './gateway';
import {
  canStartDataSyncTask,
  type DataSyncApprovalGrant,
  type DataSyncEndpointRef,
  type DataSyncPreflightSnapshot,
  type DataSyncRouteCapability,
  type DataSyncRunRecord,
  type DataSyncTaskDefinition,
} from './model';
import {
  aggregateDataSyncScheduleSummaries,
  type DataSyncScheduleSummary,
} from './modelSchedule';
import type { DataSyncWorkbenchTranslate } from './text';

export type DataSyncScheduleControlOptions = {
  getGateway: () => DataSyncWorkbenchGateway;
  t: DataSyncWorkbenchTranslate;
  /** Authoritative persisted tasks; implemented with the Shell's tasks ref. */
  getTasks: () => DataSyncTaskDefinition[];
  setTasks: (
    updater: (current: DataSyncTaskDefinition[]) => DataSyncTaskDefinition[],
  ) => void;
  isTaskDirty: (taskId: string) => boolean;
  markTaskDirty: (taskId: string) => void;
  clearTaskDirty: (taskId: string) => void;
  /** Drops the task's preflight/approval/challenge evidence after a save. */
  clearTaskEvidence: (taskId: string) => void;
  setTaskPreflight: (taskId: string, snapshot: DataSyncPreflightSnapshot) => void;
  getApproval: (taskId: string) => DataSyncApprovalGrant | null;
  setCapability: (capability: DataSyncRouteCapability) => void;
  /** Selects the task and lands the editor on its preflight stage. */
  openTaskPreflightStage: (taskId: string) => void;
  /** Jumps to the runs view with the run selected and its details loaded. */
  openRunFromSchedule: (runId: string, taskId: string) => Promise<void>;
  setOperationError: (message: string) => void;
  setOperationBusy: (busy: string) => void;
};

export type DataSyncScheduleControl = {
  schedules: DataSyncScheduleSummary[];
  /** Seeds rows from a bootstrap snapshot without re-fetching tasks. */
  ingestSnapshot: (tasks: readonly DataSyncTaskDefinition[]) => Promise<void>;
  /** Re-pulls tasks, the schedule projection, and per-task run history. */
  refresh: () => Promise<void>;
  toggleSchedule: (schedule: DataSyncScheduleSummary) => void;
  runScheduleNow: (schedule: DataSyncScheduleSummary) => void;
  viewScheduleRun: (runId: string) => Promise<void>;
};

const describeEndpoint = (
  endpoint: DataSyncEndpointRef,
): string =>
  [
    endpoint.connectionName || endpoint.connectionId,
    endpoint.database,
    endpoint.schema,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' / ');

const confirmScheduleAction = (config: {
  title: string;
  details: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): void => {
  Modal.confirm({
    title: config.title,
    content: (
      <span className="gn-data-sync-confirm-text">{config.details}</span>
    ),
    okText: config.confirmText,
    cancelText: config.cancelText,
    onOk: config.onConfirm,
    onCancel: config.onCancel,
  });
};

/**
 * Owns the schedule list: the authoritative snapshot (tasks + schedule
 * projection + per-task run history), the per-row lifecycle toggle, immediate
 * runs, and the jump into a run's history. Every action either applies an
 * authoritative gateway response or only reports an error — nothing is ever
 * faked into the local state, and the list is re-aggregated from the fresh
 * task list after every successful change.
 */
export const useDataSyncScheduleControl = (
  options: DataSyncScheduleControlOptions,
): DataSyncScheduleControl => {
  const {
    getGateway,
    t,
    getTasks,
    setTasks,
    isTaskDirty,
    markTaskDirty,
    clearTaskDirty,
    clearTaskEvidence,
    setTaskPreflight,
    getApproval,
    setCapability,
    openTaskPreflightStage,
    openRunFromSchedule,
    setOperationError,
    setOperationBusy,
  } = options;

  const [schedules, setSchedules] = useState<DataSyncScheduleSummary[]>([]);
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  // operationBusy state updates lag one render; this ref guards re-entrancy
  // synchronously between the click and the frozen buttons.
  const actionBusyRef = useRef(false);
  const loadEpochRef = useRef(0);

  const finishGuard = useCallback(() => {
    actionBusyRef.current = false;
    setOperationBusy('');
  }, [setOperationBusy]);

  const replaceTask = useCallback(
    (saved: DataSyncTaskDefinition) => {
      setTasks((current) =>
        current.map((task) => (task.id === saved.id ? saved : task)),
      );
      clearTaskDirty(saved.id);
      clearTaskEvidence(saved.id);
    },
    [clearTaskDirty, clearTaskEvidence, setTasks],
  );

  const applyScheduleSnapshot = useCallback(
    (
      tasks: readonly DataSyncTaskDefinition[],
      scheduleRows: readonly DataSyncScheduleSummary[],
      runs: readonly DataSyncRunRecord[],
    ) => {
      setSchedules(aggregateDataSyncScheduleSummaries(tasks, runs, scheduleRows));
    },
    [],
  );

  const loadPerTaskRuns = useCallback(
    async (
      tasks: readonly DataSyncTaskDefinition[],
    ): Promise<DataSyncRunRecord[]> => {
      const scheduled = tasks.filter((task) => task.trigger.mode !== 'manual');
      // The global run history is paginated, so a task's latest run can sit
      // beyond the first page; load each scheduled task's recent runs instead.
      const perTask = await Promise.all(
        scheduled.map((task) =>
          getGateway()
            .listRuns(task.id)
            .catch(() => [] as DataSyncRunRecord[]),
        ),
      );
      return perTask.flat();
    },
    [getGateway],
  );

  const refresh = useCallback(async (): Promise<void> => {
    loadEpochRef.current += 1;
    const epoch = loadEpochRef.current;
    setOperationBusy('refresh-schedules');
    try {
      // Wails derives the schedule projection from the persisted task list,
      // so the task pull must come first and feed the same snapshot.
      const tasks = await getGateway().listTasks();
      const [scheduleRows, runs] = await Promise.all([
        getGateway().listSchedules(),
        loadPerTaskRuns(tasks),
      ]);
      if (epoch !== loadEpochRef.current) return;
      applyScheduleSnapshot(tasks, scheduleRows, runs);
    } catch (error) {
      if (epoch !== loadEpochRef.current) return;
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  }, [applyScheduleSnapshot, getGateway, loadPerTaskRuns, setOperationBusy, setOperationError]);

  const ingestSnapshot = useCallback(
    async (tasks: readonly DataSyncTaskDefinition[]): Promise<void> => {
      loadEpochRef.current += 1;
      const epoch = loadEpochRef.current;
      try {
        const [scheduleRows, runs] = await Promise.all([
          getGateway().listSchedules(),
          loadPerTaskRuns(tasks),
        ]);
        if (epoch !== loadEpochRef.current) return;
        applyScheduleSnapshot(tasks, scheduleRows, runs);
      } catch (error) {
        if (epoch !== loadEpochRef.current) return;
        setOperationError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyScheduleSnapshot, getGateway, loadPerTaskRuns, setOperationError],
  );

  const resolveLatestTask = useCallback(
    async (taskId: string): Promise<DataSyncTaskDefinition | null> => {
      const tasks = await getGateway().listTasks();
      return tasks.find((task) => task.id === taskId) || null;
    },
    [getGateway],
  );

  const toggleSchedule = useCallback(
    (schedule: DataSyncScheduleSummary): void => {
      if (actionBusyRef.current) return;
      actionBusyRef.current = true;
      const enabling = !schedule.enabled;
      setOperationBusy(`${enabling ? 'enable' : 'disable'}:${schedule.taskId}`);
      void (async () => {
        let current: DataSyncTaskDefinition | null = null;
        let confirmed = false;
        try {
          current = await resolveLatestTask(schedule.taskId);
          if (!current) {
            setOperationError(t('schedules.task_missing'));
            return;
          }
          if (isTaskDirty(current.id)) {
            setOperationError(t('schedules.unsaved_edits'));
            return;
          }
          const details = [
            t('schedules.confirm_scope_source', {
              scope: describeEndpoint(current.source),
            }),
            t('schedules.confirm_scope_target', {
              scope: describeEndpoint(current.target),
            }),
            t(
              enabling
                ? 'schedules.confirm_enable_warning'
                : 'schedules.confirm_disable_warning',
            ),
          ].join('\n');
          confirmScheduleAction({
            title: t(
              enabling ? 'schedules.confirm_enable' : 'schedules.confirm_disable',
              { task: current.name },
            ),
            details,
            confirmText: t('common.yes'),
            cancelText: t('common.cancel'),
            onCancel: finishGuard,
            onConfirm: async () => {
              try {
                const target = current!;
                const next: DataSyncTaskDefinition = {
                  ...target,
                  // Store.PutJob accepts the persisted revision and advances it.
                  lifecycle: enabling ? 'enabled' : 'paused',
                };
                if (enabling) {
                  // Enabling revalidates the definition; pausing is safe and
                  // skips the preflight on purpose.
                  const [snapshot, capability] = await Promise.all([
                    getGateway().preflightTask(next),
                    getGateway().resolveCapability(next),
                  ]);
                  if (
                    snapshot.status === 'blocked' ||
                    snapshot.approvalRequired ||
                    !capability.canExecute
                  ) {
                    // Fail closed: hand the enabled definition to the editor,
                    // where preflight and any production approval complete
                    // before the definition is saved.
                    setTasks((tasks) =>
                      tasks.map((task) => (task.id === next.id ? next : task)),
                    );
                    markTaskDirty(next.id);
                    setTaskPreflight(next.id, snapshot);
                    setCapability(capability);
                    openTaskPreflightStage(next.id);
                    setOperationError(t('schedules.preflight_required'));
                    return;
                  }
                }
                const saved = await getGateway().saveTask(next);
                replaceTask(saved);
                await refresh();
              } catch (error) {
                setOperationError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                finishGuard();
              }
            },
          });
          confirmed = true;
        } catch (error) {
          setOperationError(error instanceof Error ? error.message : String(error));
        } finally {
          if (!confirmed) finishGuard();
        }
      })();
    },
    [
      finishGuard,
      getGateway,
      isTaskDirty,
      markTaskDirty,
      openTaskPreflightStage,
      refresh,
      replaceTask,
      resolveLatestTask,
      setCapability,
      setOperationBusy,
      setOperationError,
      setTaskPreflight,
      setTasks,
      t,
    ],
  );

  const runScheduleNow = useCallback(
    (schedule: DataSyncScheduleSummary): void => {
      if (actionBusyRef.current) return;
      actionBusyRef.current = true;
      setOperationBusy(`run-now:${schedule.taskId}`);
      void (async () => {
        let current: DataSyncTaskDefinition | null = null;
        let confirmed = false;
        try {
          current = await resolveLatestTask(schedule.taskId);
          if (!current) {
            setOperationError(t('schedules.task_missing'));
            return;
          }
          if (isTaskDirty(current.id)) {
            setOperationError(t('schedules.unsaved_edits'));
            return;
          }
          const details = [
            t('schedules.confirm_scope_source', {
              scope: describeEndpoint(current.source),
            }),
            t('schedules.confirm_scope_target', {
              scope: describeEndpoint(current.target),
            }),
            t('schedules.confirm_run_now_warning'),
          ].join('\n');
          confirmScheduleAction({
            title: t('schedules.confirm_run_now', { task: current.name }),
            details,
            confirmText: t('common.yes'),
            cancelText: t('common.cancel'),
            onCancel: finishGuard,
            onConfirm: async () => {
              try {
                const target = current!;
                const [snapshot, capability] = await Promise.all([
                  getGateway().preflightTask(target),
                  getGateway().resolveCapability(target),
                ]);
                if (snapshot.approvalRequired && snapshot.approvalSatisfied !== true) {
                  // A fresh preflight invalidates the gateway-side approval
                  // token, so startTask would fail on a spent grant. Fail
                  // closed into the editor, where the approval completes
                  // before the run starts — no faked local state.
                  setTaskPreflight(target.id, snapshot);
                  setCapability(capability);
                  openTaskPreflightStage(target.id);
                  setOperationError(t('schedules.preflight_required'));
                  return;
                }
                // Park the evidence on the editor preflight stage first so a
                // rejected run still shows why it was rejected.
                setTaskPreflight(target.id, snapshot);
                setCapability(capability);
                openTaskPreflightStage(target.id);
                if (
                  !capability.canExecute ||
                  !canStartDataSyncTask(target, snapshot, getApproval(target.id))
                ) {
                  setOperationError(t('schedules.preflight_required'));
                  return;
                }
                const run = await getGateway().startTask(target, snapshot);
                // The start consumed the one-shot evidence.
                clearTaskEvidence(target.id);
                await refresh();
                await openRunFromSchedule(run.id, target.id);
              } catch (error) {
                setOperationError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                finishGuard();
              }
            },
          });
          confirmed = true;
        } catch (error) {
          setOperationError(error instanceof Error ? error.message : String(error));
        } finally {
          if (!confirmed) finishGuard();
        }
      })();
    },
    [
      clearTaskEvidence,
      finishGuard,
      getApproval,
      getGateway,
      isTaskDirty,
      openRunFromSchedule,
      openTaskPreflightStage,
      refresh,
      resolveLatestTask,
      setCapability,
      setOperationBusy,
      setOperationError,
      setTaskPreflight,
      t,
    ],
  );

  const viewScheduleRun = useCallback(
    async (runId: string): Promise<void> => {
      const schedule = schedulesRef.current.find(
        (item) => item.latestRun?.id === runId,
      );
      if (!schedule) return;
      await openRunFromSchedule(runId, schedule.taskId);
    },
    [openRunFromSchedule],
  );

  return {
    schedules,
    ingestSnapshot,
    refresh,
    toggleSchedule,
    runScheduleNow,
    viewScheduleRun,
  };
};
