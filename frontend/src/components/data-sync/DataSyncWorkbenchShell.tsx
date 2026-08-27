import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  DataSyncCdcView,
  DataSyncRunHistory,
  DataSyncScheduleView,
} from './DataSyncOperationalViews';
import { DataSyncPreflightPanel } from './DataSyncPreflightPanel';
import { DataSyncRouteBar } from './DataSyncRouteBar';
import { DataSyncTaskEditor } from './DataSyncTaskEditor';
import {
  DataSyncTaskKindSelector,
  DataSyncTaskList,
} from './DataSyncTaskList';
import {
  createStaticDataSyncWorkbenchGateway,
  type DataSyncWorkbenchGateway,
} from './gateway';
import {
  canStartDataSyncTask,
  createDataSyncTaskDraft,
  isDataSyncPreflightCurrent,
  reviseDataSyncTask,
  type DataSyncCdcSourceStatus,
  type DataSyncCheckpointSummary,
  type DataSyncConnectionTreeItem,
  type DataSyncApprovalChallenge,
  type DataSyncApprovalGrant,
  type DataSyncErrorRow,
  type DataSyncPreflightSnapshot,
  type DataSyncRouteCapability,
  type DataSyncRunRecord,
  type DataSyncRunCursor,
  type DataSyncRunPage,
  type DataSyncRunPageSize,
  type DataSyncRunEvent,
  type DataSyncCompareResult,
  type DataSyncScheduleSummary,
  type DataSyncTaskDefinition,
  type DataSyncTaskKind,
  type DataSyncTaskStage,
} from './model';
import {
  createDataSyncWorkbenchTranslate,
  type DataSyncWorkbenchLocale,
} from './text';
import { decodeCompareResult } from './wailsDto';
import {
  dispatchSidebarDatabaseRefresh,
  type SidebarDatabaseRefreshRequest,
} from '../../utils/sidebarDatabaseRefresh';
import { registerWorkbenchTabCloseGuard } from '../../utils/workbenchTabCloseProtection';
import Modal from '../common/ResizableDraggableModal';
import './DataSyncWorkbench.css';

type WorkbenchView = 'tasks' | 'runs' | 'schedules' | 'cdc';

type DataSyncConfirmation =
  | {
      kind: 'delete-task';
      task: DataSyncTaskDefinition;
      title: string;
      description: string;
      confirmText: string;
    }
  | {
      kind: 'delete-run';
      runId: string;
      title: string;
      description: string;
      confirmText: string;
    }
  | {
      kind: 'clear-terminal-runs';
      title: string;
      description: string;
      confirmText: string;
    }
  | {
      kind: 'reset-checkpoint';
      taskId: string;
      revision: number;
      title: string;
      description: string;
      confirmText: string;
    };

const EMPTY_CAPABILITY: DataSyncRouteCapability = {
  level: 'unknown',
  canExecute: false,
  supportsAutoCreate: false,
  supportsMutations: false,
  supportsCdc: false,
};

const viewKeys: WorkbenchView[] = ['tasks', 'runs', 'schedules', 'cdc'];
const RUN_POLL_INTERVAL_MS = 3_000;
const ACTIVE_RUN_STATUSES = new Set<DataSyncRunRecord['status']>([
  'queued',
  'running',
  'cancelling',
  'preflighting',
  'snapshotting',
  'catching_up',
  'streaming',
]);
const SIDEBAR_REFRESH_RUN_STATUSES = new Set<DataSyncRunRecord['status']>([
  'succeeded',
  'partial',
  'failed',
  'paused',
  'canceled',
  'cancelled',
  'interrupted',
]);

/**
 * The compare executor emits one Analyze payload per table mapping, each a
 * SyncAnalyzeResult JSON (`{success,message,tables:[...]}`) carrying a single
 * table — executeOneMapping runs once per mapping. Merge every payload in
 * chronological order so a multi-mapping compare lists all of its tables
 * instead of only the last one, keeping the newest entry per table when a run
 * was resumed and a mapping re-analyzed.
 */
const extractCompareResult = (
  events: DataSyncRunEvent[],
): DataSyncCompareResult | null => {
  const byTable = new Map<string, DataSyncCompareResult['tables'][number]>();
  let latest: DataSyncCompareResult | null = null;
  for (const event of events) {
    const payload = event.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as { tables?: unknown }).tables)
    ) {
      continue;
    }
    try {
      const decoded = decodeCompareResult(payload, 'compareResult');
      latest = decoded;
      decoded.tables.forEach((table) => byTable.set(table.table, table));
    } catch {
      // Ignore malformed payloads and keep scanning the remaining events.
    }
  }
  if (!latest) return null;
  return { ...latest, tables: Array.from(byTable.values()) };
};

let localTaskSequence = 0;

const nextLocalTaskId = (): string => {
  localTaskSequence += 1;
  return `data-sync-local-${Date.now()}-${localTaskSequence}`;
};

/**
 * Turn a schema comparison into an explicit, writable schema-only task.
 * Comparison jobs remain read-only; this copy is the opt-in mutation path.
 */
export const createSchemaSyncTaskFromCompare = ({
  compareTask,
  id,
  name,
  now = new Date().toISOString(),
}: {
  compareTask: DataSyncTaskDefinition;
  id: string;
  name: string;
  now?: string;
}): DataSyncTaskDefinition | null => {
  if (compareTask.kind !== 'compare' || compareTask.compareMode !== 'schema') {
    return null;
  }
  const draft = createDataSyncTaskDraft({
    id,
    kind: 'migration',
    name,
    now,
    content: 'schema',
    sourceConnectionId: compareTask.source.connectionId,
  });
  return reviseDataSyncTask(draft, {
    source: compareTask.source,
    target: compareTask.target,
    mappings: compareTask.mappings.map((mapping) => ({
      ...mapping,
      // Schema migration uses source metadata to generate ADD COLUMN DDL;
      // row keys and field transforms are deliberately not carried over.
      targetMode: 'existing_only',
      keyColumns: [],
      fields: [],
    })),
    delivery: {
      ...draft.delivery,
      autoAddColumns: true,
    },
  });
};

export const resolveDataSyncSidebarRefreshes = ({
  previousStatuses,
  runs,
  tasks,
}: {
  previousStatuses: ReadonlyMap<string, DataSyncRunRecord['status']>;
  runs: DataSyncRunRecord[];
  tasks: DataSyncTaskDefinition[];
}): Array<{ runId: string; request: SidebarDatabaseRefreshRequest }> => {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return runs.flatMap((run) => {
    const previousStatus = previousStatuses.get(run.id);
    if (
      previousStatus === undefined
      || SIDEBAR_REFRESH_RUN_STATUSES.has(previousStatus)
      || !SIDEBAR_REFRESH_RUN_STATUSES.has(run.status)
      || !(Number(run.rowsWritten) > 0)
    ) {
      return [];
    }
    const target = tasksById.get(run.taskId)?.target;
    const connectionId = String(target?.connectionId || '').trim();
    const dbName = String(target?.database || '').trim();
    if (!connectionId || !dbName) return [];
    return [{
      runId: run.id,
      request: {
        connectionId,
        dbName,
        schemaName: String(target?.schema || '').trim() || undefined,
        reason: 'data-sync',
      },
    }];
  });
};

export type DataSyncWorkbenchShellProps = {
  initialTasks?: DataSyncTaskDefinition[];
  gateway?: DataSyncWorkbenchGateway;
  connectionTree?: DataSyncConnectionTreeItem[];
  locale?: DataSyncWorkbenchLocale | string;
  onClose?: () => void;
  workbenchTabId?: string;
};

/**
 * Keep tasks supplied by an entry point until persistence has a matching copy.
 * A persisted task wins for the same id so a stale in-memory draft cannot
 * overwrite the saved definition.
 */
export const mergeDataSyncInitialTasks = (
  initialTasks: DataSyncTaskDefinition[],
  loadedTasks: DataSyncTaskDefinition[],
  deletedTaskIds: ReadonlySet<string> = new Set(),
): DataSyncTaskDefinition[] => {
  const loadedIds = new Set(loadedTasks.map((task) => task.id));
  const missingInitialTasks = initialTasks.filter(
    (task) => !loadedIds.has(task.id) && !deletedTaskIds.has(task.id),
  );
  return [...missingInitialTasks, ...loadedTasks];
};

export const DataSyncWorkbenchShell: React.FC<DataSyncWorkbenchShellProps> = ({
  initialTasks = [],
  gateway,
  connectionTree = [],
  locale,
  onClose,
  workbenchTabId,
}) => {
  const t = useMemo(() => createDataSyncWorkbenchTranslate(locale), [locale]);
  const initialTasksRef = useRef<DataSyncTaskDefinition[]>();
  if (!initialTasksRef.current) {
    initialTasksRef.current =
      initialTasks.length > 0
        ? initialTasks
        : [
            createDataSyncTaskDraft({
              id: 'data-sync-local-draft',
              kind: 'reconcile',
              name: t('task_kind.reconcile'),
            }),
          ];
  }
  const gatewayRef = useRef<DataSyncWorkbenchGateway>();
  if (!gatewayRef.current) {
    gatewayRef.current =
      gateway ||
      createStaticDataSyncWorkbenchGateway({ tasks: initialTasksRef.current });
  }

  const [activeView, setActiveView] = useState<WorkbenchView>('tasks');
  const [tasks, setTasks] = useState<DataSyncTaskDefinition[]>(initialTasksRef.current);
  const [selectedTaskId, setSelectedTaskId] = useState(
    initialTasksRef.current[0]?.id || '',
  );
  const [activeStage, setActiveStage] = useState<DataSyncTaskStage>('endpoints');
  const [search, setSearch] = useState('');
  const [showKindSelector, setShowKindSelector] = useState(false);
  const [dirtyTaskIds, setDirtyTaskIds] = useState<Set<string>>(
    () =>
      new Set(
        initialTasksRef.current!
          .filter((task) => task.id.startsWith('data-sync-local-'))
          .map((task) => task.id),
      ),
  );
  const dirtyTaskIdsRef = useRef(dirtyTaskIds);
  const deletedTaskIdsRef = useRef(new Set<string>());
  const markTaskDirty = (taskId: string) => {
    const next = new Set(dirtyTaskIdsRef.current).add(taskId);
    dirtyTaskIdsRef.current = next;
    setDirtyTaskIds(next);
  };
  const [saving, setSaving] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [preflights, setPreflights] = useState<
    Record<string, DataSyncPreflightSnapshot | undefined>
  >({});
  const [approvals, setApprovals] = useState<
    Record<string, DataSyncApprovalGrant | undefined>
  >({});
  const [approvalChallenges, setApprovalChallenges] = useState<
    Record<string, DataSyncApprovalChallenge | undefined>
  >({});
  const [beginningApproval, setBeginningApproval] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [pendingPublicationTaskId, setPendingPublicationTaskId] = useState('');
  const [operationError, setOperationError] = useState('');
  const [operationBusy, setOperationBusy] = useState('');
  const [capability, setCapability] = useState<DataSyncRouteCapability>(
    EMPTY_CAPABILITY,
  );
  const [runs, setRuns] = useState<DataSyncRunRecord[]>([]);
  const [runPageIndex, setRunPageIndex] = useState(0);
  const [runPageSize, setRunPageSize] = useState<DataSyncRunPageSize>(10);
  const [runPageCursors, setRunPageCursors] = useState<
    Array<DataSyncRunCursor | null>
  >([null]);
  const [nextRunCursor, setNextRunCursor] = useState<DataSyncRunCursor | null>(null);
  const [runTotal, setRunTotal] = useState(0);
  const runPageRequestEpochRef = useRef(0);
  const selectedRunRequestEpochRef = useRef(0);
  const runEventsRequestEpochRef = useRef(0);
  const [schedules, setSchedules] = useState<DataSyncScheduleSummary[]>([]);
  const [cdcSources, setCdcSources] = useState<DataSyncCdcSourceStatus[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runEvents, setRunEvents] = useState<DataSyncRunEvent[]>([]);
  const [errorRows, setErrorRows] = useState<DataSyncErrorRow[]>([]);
  const [checkpoint, setCheckpoint] = useState<DataSyncCheckpointSummary | null>(null);
  const [compareResult, setCompareResult] = useState<DataSyncCompareResult | null>(
    null,
  );
  const runStatusesRef = useRef<Map<string, DataSyncRunRecord['status']>>(new Map());

  const applyRunPage = (
    page: DataSyncRunPage,
    pageIndex: number,
    cursors: Array<DataSyncRunCursor | null>,
  ) => {
    const selectedRunStillVisible = Boolean(
      selectedRunId && page.runs.some((run) => run.id === selectedRunId),
    );
    if (!selectedRunStillVisible) {
      // A page change that removes the selected run invalidates any detail
      // request for the old page. A refresh that keeps it visible must leave
      // its already-loaded event timeline/error rows/checkpoint/compare result
      // untouched.
      selectedRunRequestEpochRef.current += 1;
      runEventsRequestEpochRef.current += 1;
      setRunEvents([]);
      setErrorRows([]);
      setCheckpoint(null);
      setCompareResult(null);
    }
    setRuns(page.runs);
    setRunPageIndex(pageIndex);
    setRunPageCursors(cursors);
    setNextRunCursor(page.nextCursor);
    setRunTotal(page.total);
    setSelectedRunId((current) =>
      page.runs.some((run) => run.id === current) ? current : '',
    );
  };

  const requestRunPage = async (
    cursor: DataSyncRunCursor | null,
    pageSize: DataSyncRunPageSize,
  ): Promise<DataSyncRunPage | null> => {
    const requestEpoch = ++runPageRequestEpochRef.current;
    const page = await gatewayRef.current!.listRunsPage(cursor, pageSize);
    return requestEpoch === runPageRequestEpochRef.current ? page : null;
  };

  const reloadFirstRunPage = async () => {
    const page = await requestRunPage(null, runPageSize);
    if (page) applyRunPage(page, 0, [null]);
  };

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const selectedRunActive = Boolean(
    selectedRun && ACTIVE_RUN_STATUSES.has(selectedRun.status),
  );
  const selectedRunTask = selectedRun
    ? tasks.find((task) => task.id === selectedRun.taskId) || null
    : null;
  const selectedRunCompareMode =
    selectedRun?.compareMode ?? selectedRunTask?.compareMode;
  const checkpointTask = checkpoint
    ? tasks.find((task) => task.id === checkpoint.taskId) || null
    : null;
  const selectedPreflight = selectedTask
    ? preflights[selectedTask.id] || null
    : null;
  const selectedApproval = selectedTask ? approvals[selectedTask.id] || null : null;
  const selectedApprovalChallenge = selectedTask
    ? approvalChallenges[selectedTask.id] || null
    : null;
  const preflightStale = Boolean(
    selectedTask &&
      selectedPreflight &&
      !isDataSyncPreflightCurrent(selectedTask, selectedPreflight),
  );
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) =>
      [task.name, task.kind, task.source.connectionName, task.target.connectionName]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [search, tasks]);

  useEffect(() => {
    let active = true;
    void gatewayRef.current!
      .listTasks()
      .then((loadedTasks) => {
        if (!active) return;
        if (loadedTasks.length > 0) {
          const mergedTasks = mergeDataSyncInitialTasks(
            initialTasksRef.current!,
            loadedTasks,
            deletedTaskIdsRef.current,
          );
          setTasks((current) => {
            const currentById = new Map(current.map((task) => [task.id, task]));
            return mergedTasks.map((task) =>
              dirtyTaskIdsRef.current.has(task.id)
                ? currentById.get(task.id) || task
                : task,
            );
          });
          setSelectedTaskId((current) =>
            mergedTasks.some((task) => task.id === current)
              ? current
              : mergedTasks[0].id,
          );
        }
        return Promise.allSettled([
          requestRunPage(null, 10),
          gatewayRef.current!.listSchedules(),
          gatewayRef.current!.listCdcSources(),
        ] as const);
      })
      .then((results) => {
        if (!active || !results) return;
        const [runPage, schedules, sources] = results;
        if (runPage.status === 'fulfilled' && runPage.value) {
          applyRunPage(runPage.value, 0, [null]);
        }
        if (schedules.status === 'fulfilled') {
          setSchedules(schedules.value);
        }
        if (sources.status === 'fulfilled') {
          setCdcSources(sources.value);
        }
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (rejected) {
          setOperationError(
            rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason),
          );
        }
      })
      .catch((error) => {
        if (active) {
          setOperationError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      setCapability(EMPTY_CAPABILITY);
      return undefined;
    }
    let active = true;
    setCapability(EMPTY_CAPABILITY);
    void gatewayRef.current!
      .resolveCapability(selectedTask)
      .then((resolved) => {
        if (active) setCapability(resolved);
      })
      .catch((error) => {
        if (!active) return;
        setCapability(EMPTY_CAPABILITY);
        setOperationError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [
    selectedTask?.id,
    selectedTask?.kind,
    selectedTask?.source,
    selectedTask?.target,
    selectedTask?.incremental,
  ]);

  useEffect(() => {
    if (activeView !== 'runs') return undefined;
    const hasActiveRun = runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
    if (!hasActiveRun) return undefined;
    const timer = globalThis.setInterval(() => {
      void requestRunPage(runPageCursors[runPageIndex], runPageSize)
        .then((page) => {
          if (page) applyRunPage(page, runPageIndex, runPageCursors);
        })
        .catch((error) =>
          setOperationError(error instanceof Error ? error.message : String(error)),
        );
    }, RUN_POLL_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [activeView, runPageCursors, runPageIndex, runPageSize, runs, selectedRunId]);

  useEffect(() => {
    if (activeView !== 'runs' || !selectedRunId || !selectedRunActive) {
      return undefined;
    }
    let active = true;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const poll = async () => {
      const requestEpoch = ++runEventsRequestEpochRef.current;
      try {
        const loadedEvents = await gatewayRef.current!.listRunEvents(selectedRunId);
        if (!active || requestEpoch !== runEventsRequestEpochRef.current) return;
        setRunEvents(loadedEvents);
        setCompareResult(extractCompareResult(loadedEvents));
      } catch (error) {
        if (active && requestEpoch === runEventsRequestEpochRef.current) {
          setOperationError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (active) {
          timer = globalThis.setTimeout(poll, RUN_POLL_INTERVAL_MS);
        }
      }
    };
    timer = globalThis.setTimeout(poll, RUN_POLL_INTERVAL_MS);
    return () => {
      active = false;
      runEventsRequestEpochRef.current += 1;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [activeView, selectedRunId, selectedRunActive]);

  useEffect(() => {
    const previousStatuses = runStatusesRef.current;
    const refreshes = resolveDataSyncSidebarRefreshes({
      previousStatuses,
      runs,
      tasks,
    });
    refreshes.forEach(({ request }) => {
      dispatchSidebarDatabaseRefresh(request);
    });
    runStatusesRef.current = new Map(runs.map((run) => [run.id, run.status]));
  }, [runs, tasks]);

  const patchSelectedTask = (
    patch: Partial<
      Omit<
        DataSyncTaskDefinition,
        'id' | 'schemaVersion' | 'revision' | 'editEpoch' | 'createdAt'
      >
    >,
  ) => {
    const taskId = selectedTask?.id;
    if (!taskId) return;
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? reviseDataSyncTask(task, patch) : task,
      ),
    );
    markTaskDirty(taskId);
    setApprovalError('');
    setApprovalChallenges((current) => {
      if (!current[taskId]) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const createTask = (kind: DataSyncTaskKind) => {
    const task = createDataSyncTaskDraft({
      id: nextLocalTaskId(),
      kind,
      name: t(`task_kind.${kind}`),
    });
    deletedTaskIdsRef.current.delete(task.id);
    setTasks((current) => [...current, task]);
    setSelectedTaskId(task.id);
    markTaskDirty(task.id);
    setActiveStage('endpoints');
    setShowKindSelector(false);
    setActiveView('tasks');
  };

  const createSchemaSyncTask = () => {
    if (!selectedTask || selectedTask.kind !== 'compare' || selectedTask.compareMode !== 'schema') {
      return;
    }
    const schemaSyncName = `${selectedTask.name || t('task_kind.schema_sync')} · ${t('task_kind.schema_sync')}`;
    const task = createSchemaSyncTaskFromCompare({
      compareTask: selectedTask,
      id: nextLocalTaskId(),
      name: schemaSyncName,
    });
    if (!task) return;
    deletedTaskIdsRef.current.delete(task.id);
    setTasks((current) => [...current, task]);
    setSelectedTaskId(task.id);
    markTaskDirty(task.id);
    setActiveStage('delivery');
    setShowKindSelector(false);
    setActiveView('tasks');
  };

  const saveTask = async (taskToSave = selectedTask) => {
    if (!taskToSave || saving) return null;
    const submittedTaskId = taskToSave.id;
    setSaving(true);
    setOperationError('');
    try {
      const saved = await gatewayRef.current!.saveTask(taskToSave);
      let refreshedPreflight: DataSyncPreflightSnapshot | null = null;
      let refreshError: unknown = null;
      if (saved.lifecycle === 'ready' || saved.lifecycle === 'enabled') {
        try {
          // PutJob advances the persisted revision. Revalidate that exact
          // revision before exposing the run action; the old snapshot is no
          // longer sufficient evidence, even when the visible fields did not
          // change.
          refreshedPreflight = await gatewayRef.current!.preflightTask(saved);
        } catch (error) {
          refreshError = error;
        }
      }
      setTasks((current) => {
        const next = current.flatMap((task) => {
          if (task.id === submittedTaskId) return [saved];
          if (task.id === saved.id) return [];
          return [task];
        });
        return next.some((task) => task.id === saved.id) ? next : [...next, saved];
      });
      setPreflights((current) => {
        const next = { ...current };
        delete next[submittedTaskId];
        delete next[saved.id];
        if (refreshedPreflight) {
          next[saved.id] = refreshedPreflight;
        } else if (saved.id !== submittedTaskId) {
          const previous = current[submittedTaskId];
          if (previous) {
            next[saved.id] = {
              ...previous,
              taskId: saved.id,
              // A server-assigned identity can change the authoritative
              // definition hash. Keep the evidence visible, but stale.
              taskRevision:
                previous.taskRevision === saved.revision
                  ? previous.taskRevision - 1
                  : previous.taskRevision,
            };
          }
        }
        return next;
      });
      if (saved.id !== submittedTaskId) {
        setSelectedTaskId((current) =>
          current === submittedTaskId ? saved.id : current,
        );
      }
      setDirtyTaskIds((current) => {
        const next = new Set(current);
        next.delete(submittedTaskId);
        next.delete(saved.id);
        dirtyTaskIdsRef.current = next;
        return next;
      });
      setApprovals((current) => {
        const next = { ...current };
        delete next[submittedTaskId];
        delete next[saved.id];
        return next;
      });
      setApprovalChallenges((current) => {
        const next = { ...current };
        delete next[submittedTaskId];
        delete next[saved.id];
        return next;
      });
      if (refreshError) {
        setOperationError(
          `任务已保存，但保存后的预检失败：${
            refreshError instanceof Error ? refreshError.message : String(refreshError)
          }`,
        );
      }
      return saved;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!workbenchTabId) return undefined;
    return registerWorkbenchTabCloseGuard(workbenchTabId, {
      isDirty: () => dirtyTaskIdsRef.current.size > 0,
      save: async () => {
        const dirtyTaskIds = Array.from(dirtyTaskIdsRef.current);
        for (const taskId of dirtyTaskIds) {
          const task = tasks.find((item) => item.id === taskId);
          if (!task || !(await saveTask(task))) return false;
        }
        return dirtyTaskIdsRef.current.size === 0;
      },
      // Closing unmounts this workbench. The pending in-memory definitions
      // are intentionally discarded only after the user chose that action.
      discard: () => undefined,
    });
  }, [saveTask, tasks, workbenchTabId]);

  const runPreflight = async () => {
    if (!selectedTask || preflighting) return;
    setPreflighting(true);
    setOperationError('');
    try {
      const snapshot = await gatewayRef.current!.preflightTask(selectedTask);
      setPreflights((current) => ({ ...current, [selectedTask.id]: snapshot }));
      setApprovals((current) => {
        const approval = current[selectedTask.id];
        if (!approval || approval.definitionHash === snapshot.definitionHash) return current;
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setApprovalChallenges((current) => {
        const challenge = current[selectedTask.id];
        if (!challenge || challenge.definitionHash === snapshot.definitionHash) {
          return current;
        }
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setActiveStage('preflight');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreflighting(false);
    }
  };

  const deleteTask = async (task: DataSyncTaskDefinition) => {
    if (operationBusy === 'delete') return;
    setOperationBusy('delete');
    setOperationError('');
    try {
      await gatewayRef.current!.deleteTask(task.id);
      deletedTaskIdsRef.current.add(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setDirtyTaskIds((current) => {
        if (!current.has(task.id)) return current;
        const next = new Set(current);
        next.delete(task.id);
        dirtyTaskIdsRef.current = next;
        return next;
      });
      setPreflights((current) => {
        if (!current[task.id]) return current;
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      setApprovals((current) => {
        if (!current[task.id]) return current;
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      setApprovalChallenges((current) => {
        if (!current[task.id]) return current;
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      setSelectedTaskId((current) => {
        if (current !== task.id) return current;
        const remaining = tasks.filter((item) => item.id !== task.id);
        return remaining[0]?.id || '';
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const startTask = async () => {
    if (
      !selectedTask ||
      !selectedPreflight ||
      !capability.canExecute ||
      dirtyTaskIds.has(selectedTask.id) ||
      !canStartDataSyncTask(selectedTask, selectedPreflight, selectedApproval)
    ) {
      return;
    }
    setOperationBusy('start');
    setOperationError('');
    try {
      await gatewayRef.current!.startTask(
        selectedTask,
        selectedPreflight,
      );
      // The backend may consume a production approval and persist a new job
      // revision before creating the run. Invalidate the one-shot evidence
      // immediately, then refresh the authoritative task before the run page
      // so a history-load failure cannot leave the editor on the old revision.
      setPreflights((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setApprovals((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setApprovalChallenges((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      const refreshedTask = (await gatewayRef.current!.listTasks()).find(
        (task) => task.id === selectedTask.id,
      );
      if (refreshedTask) {
        setTasks((current) =>
          current.map((task) =>
            task.id === refreshedTask.id ? refreshedTask : task,
          ),
        );
        setPreflights((current) => {
          const next = { ...current };
          delete next[refreshedTask.id];
          return next;
        });
        setApprovals((current) => {
          const next = { ...current };
          delete next[refreshedTask.id];
          return next;
        });
        setApprovalChallenges((current) => {
          const next = { ...current };
          delete next[refreshedTask.id];
          return next;
        });
      }
      await reloadFirstRunPage();
      setActiveView('runs');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovals((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setOperationBusy('');
    }
  };

  const selectRun = async (runId: string) => {
    const requestEpoch = ++selectedRunRequestEpochRef.current;
    const eventRequestEpoch = ++runEventsRequestEpochRef.current;
    setSelectedRunId(runId);
    setRunEvents([]);
    setErrorRows([]);
    setCheckpoint(null);
    setCompareResult(null);
    const run = runs.find((item) => item.id === runId);
    setOperationError('');
    try {
      const [rows, loadedCheckpoint, events] = await Promise.all([
        gatewayRef.current!.listErrorRows(runId),
        run ? gatewayRef.current!.getCheckpoint(run.taskId) : Promise.resolve(null),
        gatewayRef.current!.listRunEvents(runId),
      ]);
      if (requestEpoch !== selectedRunRequestEpochRef.current) return;
      if (eventRequestEpoch === runEventsRequestEpochRef.current) {
        setRunEvents(events);
      }
      setErrorRows(rows);
      setCheckpoint(loadedCheckpoint);
      setCompareResult(extractCompareResult(events));
    } catch (error) {
      if (requestEpoch !== selectedRunRequestEpochRef.current) return;
      if (eventRequestEpoch === runEventsRequestEpochRef.current) {
        setRunEvents([]);
      }
      setErrorRows([]);
      setCheckpoint(null);
      setCompareResult(null);
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  const beginApproval = async () => {
    if (!selectedTask || !selectedPreflight || beginningApproval) return;
    setBeginningApproval(true);
    setApprovalError('');
    try {
      const challenge = await gatewayRef.current!.beginApproval(
        selectedTask,
        selectedPreflight,
      );
      setApprovalChallenges((current) => ({
        ...current,
        [selectedTask.id]: challenge,
      }));
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBeginningApproval(false);
    }
  };

  const approveTask = async () => {
    if (!selectedTask || !selectedPreflight || approving) return;
    const publicationPending = pendingPublicationTaskId === selectedTask.id;
    setApproving(true);
    setApprovalError('');
    try {
      const grant = await gatewayRef.current!.approveTask(
        selectedTask,
        selectedPreflight,
      );
      setApprovals((current) => ({ ...current, [selectedTask.id]: grant }));
      if (publicationPending) {
        const saved = await saveTask(selectedTask);
        if (!saved) {
          // A one-time approval token may have been consumed by an uncertain
          // save attempt. Return to draft so a retry must preflight and approve
          // the exact definition again instead of reusing stale authority.
          setTasks((current) =>
            current.map((task) =>
              task.id === selectedTask.id
                ? reviseDataSyncTask(task, { lifecycle: 'draft' })
                : task,
            ),
          );
          markTaskDirty(selectedTask.id);
        }
        setPendingPublicationTaskId('');
      }
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovalChallenges((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setApproving(false);
    }
  };

  const refreshRuns = async () => {
    setOperationBusy('refresh-runs');
    setOperationError('');
    try {
      const page = await requestRunPage(
        runPageCursors[runPageIndex],
        runPageSize,
      );
      if (page) applyRunPage(page, runPageIndex, runPageCursors);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const updateRun = async (
    action: 'cancel' | 'resume' | 'retry',
    runId: string,
  ) => {
    setOperationBusy(`${action}:${runId}`);
    setOperationError('');
    try {
      if (action === 'cancel') {
        await gatewayRef.current!.cancelRun(runId);
        setRuns((current) =>
          current.map((run) =>
            run.id === runId ? { ...run, status: 'cancelling' } : run,
          ),
        );
      } else {
        if (action === 'resume') {
          await gatewayRef.current!.resumeRun(runId);
        } else {
          await gatewayRef.current!.retryRun(runId);
        }
        await reloadFirstRunPage();
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const discardErrorRow = async (errorRowId: string) => {
    setOperationBusy(`discard:${errorRowId}`);
    setOperationError('');
    try {
      await gatewayRef.current!.discardErrorRow(errorRowId);
      setErrorRows((current) =>
        current.map((row) =>
          row.id === errorRowId ? { ...row, status: 'discarded' } : row,
        ),
      );
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const retryErrorRow = async (errorRowId: string) => {
    if (!gatewayRef.current!.capabilities.errorRowRetry) return;
    const errorRow = errorRows.find((row) => row.id === errorRowId);
    if (!errorRow || !errorRow.retryable || errorRow.status !== 'pending') return;
    setOperationBusy(`retry-row:${errorRowId}`);
    setOperationError('');
    try {
      const retried = await gatewayRef.current!.retryErrorRow(errorRowId);
      setErrorRows((current) =>
        current.map((row) => (row.id === retried.id ? retried : row)),
      );
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      // A retry may consume a one-time production approval token. Clear the
      // visible grant even on an uncertain response so it cannot appear reusable.
      setApprovals((current) => {
        if (!current[errorRow.taskId]) return current;
        const next = { ...current };
        delete next[errorRow.taskId];
        return next;
      });
      setOperationBusy('');
    }
  };

  const resetCheckpointForTask = async (taskId: string, revision: number) => {
    if (operationBusy === 'reset-checkpoint') return;
    setOperationBusy('reset-checkpoint');
    setOperationError('');
    try {
      const saved = await gatewayRef.current!.resetCheckpoint(
        taskId,
        revision,
      );
      setTasks((current) =>
        current.map((task) => (task.id === saved.id ? saved : task)),
      );
      setPreflights((current) => {
        if (!current[saved.id]) return current;
        const next = { ...current };
        delete next[saved.id];
        return next;
      });
      setApprovals((current) => {
        if (!current[saved.id]) return current;
        const next = { ...current };
        delete next[saved.id];
        return next;
      });
      setApprovalChallenges((current) => {
        if (!current[saved.id]) return current;
        const next = { ...current };
        delete next[saved.id];
        return next;
      });
      setCheckpoint(null);
      setCdcSources(await gatewayRef.current!.listCdcSources());
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const refreshSchedules = async () => {
    setOperationBusy('refresh-schedules');
    try {
      setSchedules(await gatewayRef.current!.listSchedules());
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const refreshCdc = async () => {
    setOperationBusy('refresh-cdc');
    try {
      setCdcSources(await gatewayRef.current!.listCdcSources());
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const locateIssue = (stage: DataSyncTaskStage) => {
    setActiveView('tasks');
    setShowKindSelector(false);
    setActiveStage(stage);
  };

  const transitionLifecycle = (
    lifecycle: DataSyncTaskDefinition['lifecycle'],
  ) => {
    patchSelectedTask({ lifecycle });
    setActiveStage('preflight');
  };

  const publishTask = async () => {
    if (!selectedTask || saving || preflighting) return;
    const candidate = reviseDataSyncTask(selectedTask, { lifecycle: 'ready' });
    setPreflighting(true);
    setOperationError('');
    setApprovalError('');
    try {
      const snapshot = await gatewayRef.current!.preflightTask(candidate);
      setActiveStage('preflight');
      if (snapshot.status === 'blocked') {
        // Keep the editor on the persisted draft. A blocked publication must
        // never leave an unsaved ready state that the user cannot recover from.
        setPreflights((current) => ({
          ...current,
          [selectedTask.id]: {
            ...snapshot,
            taskRevision: selectedTask.revision,
            taskEditEpoch: selectedTask.editEpoch,
          },
        }));
        return;
      }
      if (snapshot.approvalRequired) {
        // The approval token is tied to this exact candidate definition. Keep
        // it selected until approval completes, then save it atomically.
        setTasks((current) =>
          current.map((task) => (task.id === candidate.id ? candidate : task)),
        );
        markTaskDirty(candidate.id);
        setPreflights((current) => ({ ...current, [candidate.id]: snapshot }));
        setApprovals((current) => {
          const next = { ...current };
          delete next[candidate.id];
          return next;
        });
        setApprovalChallenges((current) => {
          const next = { ...current };
          delete next[candidate.id];
          return next;
        });
        setPendingPublicationTaskId(candidate.id);
        return;
      }
      await saveTask(candidate);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreflighting(false);
    }
  };

  const changeRunPage = async (direction: 'previous' | 'next') => {
    if (direction === 'previous' && runPageIndex === 0) return;
    if (direction === 'next' && !nextRunCursor) return;
    const cursor =
      direction === 'previous'
        ? runPageCursors[runPageIndex - 1]
        : nextRunCursor;
    const nextIndex = direction === 'previous' ? runPageIndex - 1 : runPageIndex + 1;
    const cursors =
      direction === 'previous'
        ? runPageCursors.slice(0, nextIndex + 1)
        : [...runPageCursors.slice(0, runPageIndex + 1), cursor];
    setOperationBusy('page-runs');
    setOperationError('');
    try {
      const page = await requestRunPage(cursor, runPageSize);
      if (page) applyRunPage(page, nextIndex, cursors);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const changeRunPageSize = async (pageSize: DataSyncRunPageSize) => {
    if (pageSize === runPageSize) return;
    setOperationBusy('page-runs');
    setOperationError('');
    setRunPageSize(pageSize);
    try {
      const page = await requestRunPage(null, pageSize);
      if (page) applyRunPage(page, 0, [null]);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const deleteRunHistory = async (runId: string) => {
    if (operationBusy === `delete-run:${runId}`) return;
    setOperationBusy(`delete-run:${runId}`);
    setOperationError('');
    try {
      await gatewayRef.current!.deleteRun(runId);
      let page = await requestRunPage(
        runPageCursors[runPageIndex],
        runPageSize,
      );
      if (!page) return;
      let pageIndex = runPageIndex;
      let cursors = runPageCursors;
      if (page.runs.length === 0 && pageIndex > 0) {
        pageIndex -= 1;
        cursors = runPageCursors.slice(0, pageIndex + 1);
        page = await requestRunPage(cursors[pageIndex], runPageSize);
        if (!page) return;
      }
      applyRunPage(page, pageIndex, cursors);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const clearTerminalRunHistory = async () => {
    if (operationBusy === 'clear-runs') return;
    setOperationBusy('clear-runs');
    setOperationError('');
    try {
      await gatewayRef.current!.clearTerminalRuns();
      const page = await requestRunPage(null, runPageSize);
      if (page) applyRunPage(page, 0, [null]);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy('');
    }
  };

  const executeConfirmation = async (confirmation: DataSyncConfirmation) => {
    switch (confirmation.kind) {
      case 'delete-task':
        await deleteTask(confirmation.task);
        break;
      case 'delete-run':
        await deleteRunHistory(confirmation.runId);
        break;
      case 'clear-terminal-runs':
        await clearTerminalRunHistory();
        break;
      case 'reset-checkpoint':
        await resetCheckpointForTask(
          confirmation.taskId,
          confirmation.revision,
        );
        break;
    }
  };

  const openConfirmation = (confirmation: DataSyncConfirmation) => {
    Modal.confirm({
      title: confirmation.title,
      content: confirmation.description,
      okText: confirmation.confirmText,
      cancelText: t('common.cancel'),
      centered: true,
      closable: true,
      maskClosable: true,
      okButtonProps: { danger: true, type: 'primary' },
      onOk: () => executeConfirmation(confirmation),
    });
  };

  const requestDeleteSelectedTask = () => {
    if (!selectedTask || operationBusy === 'delete') return;
    openConfirmation({
      kind: 'delete-task',
      task: selectedTask,
      title: t('workbench.delete_confirm_title'),
      description: t('workbench.delete_confirm'),
      confirmText: t('workbench.delete'),
    });
  };

  const requestDeleteRunHistory = (runId: string) => {
    if (operationBusy === `delete-run:${runId}`) return;
    openConfirmation({
      kind: 'delete-run',
      runId,
      title: t('runs.delete_confirm_title'),
      description: t('runs.delete_confirm'),
      confirmText: t('runs.delete'),
    });
  };

  const requestClearTerminalRunHistory = () => {
    if (operationBusy === 'clear-runs') return;
    openConfirmation({
      kind: 'clear-terminal-runs',
      title: t('runs.clear_terminal_confirm_title'),
      description: t('runs.clear_terminal_confirm'),
      confirmText: t('runs.clear_terminal'),
    });
  };

  const requestResetCheckpoint = () => {
    if (!checkpoint || !checkpointTask || checkpointTask.lifecycle !== 'paused') {
      return;
    }
    openConfirmation({
      kind: 'reset-checkpoint',
      taskId: checkpoint.taskId,
      revision: checkpointTask.revision,
      title: t('checkpoint.reset_confirm_title'),
      description: t('checkpoint.reset_warning'),
      confirmText: t('checkpoint.reset'),
    });
  };

  const actionEnabled = Boolean(
    selectedTask &&
      selectedPreflight &&
      capability.canExecute &&
      !dirtyTaskIds.has(selectedTask.id) &&
      canStartDataSyncTask(selectedTask, selectedPreflight, selectedApproval),
  );
  const selectedApprovalCurrent = Boolean(
    selectedPreflight &&
      selectedApproval &&
      selectedApproval.definitionHash === selectedPreflight.definitionHash &&
      Date.parse(selectedApproval.expiresAt) > Date.now(),
  );
  const currentPreflightRequiresApproval = Boolean(
    selectedPreflight &&
      !preflightStale &&
      selectedPreflight.approvalRequired !== false &&
      !selectedPreflight.approvalSatisfied &&
      !selectedApprovalCurrent,
  );
  const runActionTitle = actionEnabled
    ? t('workbench.start')
    : !selectedTask
      ? t('workbench.preflight_before_run')
      : selectedTask.lifecycle !== 'ready' && selectedTask.lifecycle !== 'enabled'
        ? t('workbench.lifecycle_before_run')
        : dirtyTaskIds.has(selectedTask.id)
          ? !selectedPreflight || preflightStale
            ? t('workbench.preflight_then_save_before_run')
            : selectedPreflight.status === 'blocked'
              ? t('workbench.blocked_action')
              : currentPreflightRequiresApproval
              ? t('workbench.approval_before_run')
              : t('workbench.save_before_run')
          : !selectedPreflight || preflightStale
            ? t('workbench.preflight_before_run')
            : selectedPreflight.status === 'blocked'
              ? t('workbench.blocked_action')
              : !capability.canExecute
                ? t('workbench.capability_before_run')
                : currentPreflightRequiresApproval
                  ? t('workbench.approval_before_run')
                  : t('workbench.preflight_before_run');
  const saveApprovalReady = Boolean(
    selectedTask &&
      (selectedTask.lifecycle === 'draft' ||
        selectedTask.lifecycle === 'paused' ||
        selectedTask.lifecycle === 'archived' ||
        (selectedPreflight &&
          isDataSyncPreflightCurrent(selectedTask, selectedPreflight) &&
          selectedPreflight.status !== 'blocked' &&
          (selectedPreflight.approvalRequired === false ||
            Boolean(
              selectedApproval &&
                selectedApproval.definitionHash === selectedPreflight.definitionHash &&
                Date.parse(selectedApproval.expiresAt) > Date.now(),
            )))),
  );

  return (
    <div
      className="gn-data-sync-workbench"
      data-data-sync-workbench-shell="true"
    >
      <header className="gn-data-sync-workbench__header">
        <div className="gn-data-sync-workbench__identity">
          <strong>{t('workbench.title')}</strong>
          <span>{t('workbench.subtitle')}</span>
        </div>
        <nav className="gn-data-sync-global-nav" aria-label={t('workbench.title')}>
          {viewKeys.map((view) => (
            <button
              key={view}
              type="button"
              data-active={activeView === view ? 'true' : 'false'}
              onClick={() => setActiveView(view)}
            >
              {t(`nav.${view}`)}
            </button>
          ))}
        </nav>
        <div className="gn-data-sync-workbench__header-actions">
          <button
            type="button"
            className="gn-data-sync-button"
            onClick={() => {
              setActiveView('tasks');
              setShowKindSelector(true);
            }}
          >
            {t('workbench.new_task')}
          </button>
          {onClose ? (
            <button
              type="button"
              className="gn-data-sync-icon-button"
              aria-label={t('workbench.close')}
              title={t('workbench.close')}
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </header>

      {operationError ? (
        <div className="gn-data-sync-workbench-error" role="alert">
          <span>{operationError}</span>
          <button
            type="button"
            className="gn-data-sync-link-button"
            onClick={() => setOperationError('')}
          >
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}

      {activeView === 'tasks' ? (
        <div className="gn-data-sync-workspace-grid">
          <DataSyncTaskList
            tasks={filteredTasks}
            selectedTaskId={selectedTaskId}
            search={search}
            t={t}
            onSearchChange={setSearch}
            onSelectTask={(taskId) => {
              setSelectedTaskId(taskId);
              setShowKindSelector(false);
            }}
            onNewTask={() => setShowKindSelector(true)}
          />
          <main className="gn-data-sync-editor-column">
            {showKindSelector || !selectedTask ? (
              <DataSyncTaskKindSelector t={t} onSelect={createTask} />
            ) : (
              <>
                <DataSyncRouteBar
                  source={selectedTask.source}
                  target={selectedTask.target}
                  capability={capability}
                  active={selectedTask.kind === 'cdc' && selectedTask.lifecycle === 'enabled'}
                  t={t}
                />
                <DataSyncTaskEditor
                  task={selectedTask}
                  gateway={gatewayRef.current!}
                  connectionTree={connectionTree}
                  capability={capability}
                  activeStage={activeStage}
                  preflight={selectedPreflight}
                  preflightStale={preflightStale}
                  t={t}
                  onStageChange={setActiveStage}
                  onPatch={patchSelectedTask}
                />
                <footer className="gn-data-sync-action-bar">
                  <span
                    className="gn-data-sync-save-state"
                    data-dirty={dirtyTaskIds.has(selectedTask.id) ? 'true' : 'false'}
                  >
                    {dirtyTaskIds.has(selectedTask.id)
                      ? t('workbench.unsaved')
                      : t('workbench.saved')}
                  </span>
                  <span className="gn-data-sync-action-bar__spacer" />
                  {selectedTask.lifecycle === 'draft' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      disabled={saving || preflighting}
                      onClick={() => void publishTask()}
                    >
                      {t('lifecycle.publish_ready')}
                    </button>
                  ) : null}
                  {selectedTask.lifecycle === 'ready' &&
                  selectedTask.trigger.mode !== 'manual' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      onClick={() => transitionLifecycle('enabled')}
                    >
                      {t('lifecycle.enable_schedule')}
                    </button>
                  ) : null}
                  {selectedTask.lifecycle === 'enabled' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      onClick={() => transitionLifecycle('paused')}
                    >
                      {t('lifecycle.pause')}
                    </button>
                  ) : null}
                  {selectedTask.lifecycle === 'paused' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      onClick={() => transitionLifecycle('enabled')}
                    >
                      {t('lifecycle.resume_schedule')}
                    </button>
                  ) : null}
                  {selectedTask.lifecycle === 'archived' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      onClick={() => transitionLifecycle('draft')}
                    >
                      {t('lifecycle.restore')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="gn-data-sync-link-button gn-data-sync-link-button--danger"
                      onClick={() => transitionLifecycle('archived')}
                    >
                      {t('lifecycle.archive')}
                    </button>
                  )}
                  {selectedTask.lifecycle !== 'archived' ? (
                    <button
                      type="button"
                      className="gn-data-sync-link-button gn-data-sync-link-button--danger"
                      disabled={operationBusy === 'delete'}
                      onClick={requestDeleteSelectedTask}
                    >
                      {operationBusy === 'delete'
                        ? t('workbench.deleting')
                        : t('workbench.delete')}
                    </button>
                  ) : null}
                  {selectedTask.kind === 'compare' && selectedTask.compareMode === 'schema' ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      data-data-sync-action="create-schema-sync"
                      onClick={createSchemaSyncTask}
                    >
                      {t('workbench.create_schema_sync')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="gn-data-sync-button"
                    disabled={
                      saving ||
                      !dirtyTaskIds.has(selectedTask.id) ||
                      !saveApprovalReady
                    }
                    onClick={() => void saveTask()}
                  >
                    {saving ? t('workbench.saving') : t('workbench.save')}
                  </button>
                  <button
                    type="button"
                    className="gn-data-sync-button"
                    disabled={preflighting}
                    onClick={() => void runPreflight()}
                  >
                    {preflighting
                      ? t('workbench.preflighting')
                      : t('workbench.run_preflight')}
                  </button>
                  <button
                    type="button"
                    className="gn-data-sync-button gn-data-sync-button--primary"
                    disabled={!actionEnabled || operationBusy === 'start'}
                    title={runActionTitle}
                    onClick={() => void startTask()}
                  >
                    {t('workbench.start')}
                  </button>
                </footer>
              </>
            )}
          </main>
          {selectedTask && !showKindSelector ? (
            <DataSyncPreflightPanel
              snapshot={selectedPreflight}
              currentRevision={selectedTask.revision}
              stale={preflightStale}
              running={preflighting}
              t={t}
              onLocateIssue={locateIssue}
              approval={selectedApproval}
              approvalChallenge={selectedApprovalChallenge}
              beginningApproval={beginningApproval}
              approving={approving}
              approvalError={approvalError}
              onBeginApproval={() => void beginApproval()}
              onApprove={() => void approveTask()}
            />
          ) : (
            <aside className="gn-data-sync-preflight gn-data-sync-preflight--blank" />
          )}
        </div>
      ) : null}

      {activeView === 'runs' ? (
        <DataSyncRunHistory
          runs={runs}
          runPage={runPageIndex + 1}
          runPageSize={runPageSize}
          runTotal={runTotal}
          hasPreviousRunPage={runPageIndex > 0}
          hasNextRunPage={nextRunCursor !== null}
          selectedRunId={selectedRunId}
          selectedRunMessage={runs.find(
            (run) =>
              run.id === selectedRunId &&
              ['failed', 'partial', 'interrupted'].includes(run.status),
          )?.message}
          runEvents={runEvents}
          errorRows={errorRows}
          compareResult={compareResult}
          compareMode={selectedRunCompareMode}
          t={t}
          onSelectRun={(runId) => void selectRun(runId)}
          checkpoint={checkpoint}
          busyAction={operationBusy}
          onRefresh={() => void refreshRuns()}
          onPreviousRunPage={() => void changeRunPage('previous')}
          onNextRunPage={() => void changeRunPage('next')}
          onRunPageSizeChange={(pageSize) => void changeRunPageSize(pageSize)}
          onDeleteRun={requestDeleteRunHistory}
          onClearTerminalRuns={requestClearTerminalRunHistory}
          onCancel={(runId) => void updateRun('cancel', runId)}
          onResume={(runId) => void updateRun('resume', runId)}
          onRetry={(runId) => void updateRun('retry', runId)}
          onDiscardErrorRow={(errorRowId) => void discardErrorRow(errorRowId)}
          errorRowRetryAvailable={gatewayRef.current!.capabilities.errorRowRetry}
          onRetryErrorRow={(errorRowId) => void retryErrorRow(errorRowId)}
          checkpointResetEnabled={checkpointTask?.lifecycle === 'paused'}
          onResetCheckpoint={requestResetCheckpoint}
        />
      ) : null}
      {activeView === 'schedules' ? (
        <DataSyncScheduleView
          schedules={schedules}
          t={t}
          refreshing={operationBusy === 'refresh-schedules'}
          onRefresh={() => void refreshSchedules()}
        />
      ) : null}
      {activeView === 'cdc' ? (
        <DataSyncCdcView
          sources={cdcSources}
          t={t}
          refreshing={operationBusy === 'refresh-cdc'}
          onRefresh={() => void refreshCdc()}
        />
      ) : null}
    </div>
  );
};
