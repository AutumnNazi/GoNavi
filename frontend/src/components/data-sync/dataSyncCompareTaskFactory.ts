import {
  createDataSyncTaskDraft,
  reviseDataSyncTask,
  type DataSyncTaskDefinition,
} from './model';

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

export const createSyncTaskFromCompare = ({
  compareTask,
  id,
  name,
  now = new Date().toISOString(),
  tables,
}: {
  compareTask: DataSyncTaskDefinition;
  id: string;
  name: string;
  now?: string;
  tables?: string[];
}): DataSyncTaskDefinition | null => {
  if (compareTask.kind !== 'compare') return null;
  const allowed = tables && tables.length > 0 ? new Set(tables) : null;
  const mappings = allowed
    ? compareTask.mappings.filter(
        (mapping) =>
          allowed.has(mapping.sourceObject) || allowed.has(mapping.targetObject),
      )
    : compareTask.mappings;
  const scoped = { ...compareTask, mappings };
  if (compareTask.compareMode === 'schema') {
    return createSchemaSyncTaskFromCompare({
      compareTask: scoped,
      id,
      name,
      now,
    });
  }
  const draft = createDataSyncTaskDraft({
    id,
    kind: 'reconcile',
    name,
    now,
    sourceConnectionId: compareTask.source.connectionId,
  });
  return reviseDataSyncTask(draft, {
    source: compareTask.source,
    target: compareTask.target,
    mappings,
  });
};
