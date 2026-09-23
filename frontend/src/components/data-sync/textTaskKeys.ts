import type { DataSyncWorkbenchTextKey } from './text';

export const dataSyncTaskKindTextKey = (
  task: {
    kind: import('./model').DataSyncTaskKind;
    compareMode?: import('./model').DataSyncCompareMode;
  },
): DataSyncWorkbenchTextKey => {
  if (task.kind === 'compare') {
    return task.compareMode === 'schema'
      ? 'task_kind.compare_schema'
      : 'task_kind.compare_data';
  }
  return `task_kind.${task.kind}` as DataSyncWorkbenchTextKey;
};

export const dataSyncTaskKindChoiceTextKey = (
  choice: import('./model').DataSyncTaskKindChoice,
): DataSyncWorkbenchTextKey => dataSyncTaskKindTextKey(choice);

export const dataSyncStageTextKey = (
  stage: import('./model').DataSyncTaskStage,
  kind: import('./model').DataSyncTaskKind,
  compareMode?: import('./model').DataSyncCompareMode,
): DataSyncWorkbenchTextKey => {
  if (kind === 'backup' && stage === 'endpoints') return 'stage.backup_source';
  if (kind === 'backup' && stage === 'mappings') return 'stage.backup_objects';
  if (kind === 'backup' && stage === 'delivery') return 'stage.backup_output';
  if (kind === 'compare' && stage === 'mappings') {
    return compareMode === 'schema'
      ? 'stage.mappings_schema_compare'
      : 'stage.mappings_data_compare';
  }
  if (kind === 'compare' && stage === 'preflight') {
    return 'stage.preflight_compare';
  }
  return `stage.${stage}` as DataSyncWorkbenchTextKey;
};
