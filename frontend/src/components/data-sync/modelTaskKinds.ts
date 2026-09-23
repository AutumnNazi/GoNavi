export type DataSyncTaskKind =
  | 'backup'
  | 'migration'
  | 'reconcile'
  | 'querySink'
  | 'compare'
  | 'cdc';

export type DataSyncTaskLifecycle =
  | 'draft'
  | 'ready'
  | 'enabled'
  | 'paused'
  | 'archived';

export type DataSyncTaskStage =
  | 'endpoints'
  | 'mappings'
  | 'delivery'
  | 'trigger'
  | 'preflight';

export const DATA_SYNC_TASK_STAGES: readonly DataSyncTaskStage[] = [
  'endpoints',
  'mappings',
  'delivery',
  'trigger',
  'preflight',
];

export const DATA_SYNC_COMPARE_STAGES: readonly DataSyncTaskStage[] = [
  'endpoints',
  'mappings',
];

export const dataSyncTaskStages = (
  kind: DataSyncTaskKind,
): readonly DataSyncTaskStage[] =>
  kind === 'compare' ? DATA_SYNC_COMPARE_STAGES : DATA_SYNC_TASK_STAGES;

export type DataSyncCompareMode = 'schema' | 'data' | 'both';

/** Workbench family: sync kinds vs read-only compare kinds. */
export type DataSyncWorkbenchFamily = 'sync' | 'compare';

export type DataSyncTaskKindChoice = {
  kind: DataSyncTaskKind;
  compareMode?: Exclude<DataSyncCompareMode, 'both'>;
};

export const DATA_SYNC_FAMILY_KIND_CHOICES: Record<
  DataSyncWorkbenchFamily,
  readonly DataSyncTaskKindChoice[]
> = {
  sync: [
    { kind: 'backup' },
    { kind: 'migration' },
    { kind: 'reconcile' },
    { kind: 'querySink' },
    { kind: 'cdc' },
  ],
  compare: [
    { kind: 'compare', compareMode: 'schema' },
    { kind: 'compare', compareMode: 'data' },
  ],
};

export const dataSyncTaskBelongsToFamily = (
  task: { kind: DataSyncTaskKind },
  family: DataSyncWorkbenchFamily,
): boolean => (family === 'compare' ? task.kind === 'compare' : task.kind !== 'compare');

/** Content selected by a writable migration task. */
export type DataSyncContent = 'data' | 'schema' | 'both';
