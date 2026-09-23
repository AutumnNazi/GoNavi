import React from 'react';

import {
  DATA_SYNC_FAMILY_KIND_CHOICES,
  type DataSyncCompareMode,
  type DataSyncTaskDefinition,
  type DataSyncTaskKind,
  type DataSyncTaskKindChoice,
  type DataSyncWorkbenchFamily,
} from './model';
import {
  dataSyncTaskKindChoiceTextKey,
  dataSyncTaskKindTextKey,
  type DataSyncWorkbenchTextKey,
  type DataSyncWorkbenchTranslate,
} from './text';

const endpointName = (
  task: DataSyncTaskDefinition,
  side: 'source' | 'target',
  fallback: string,
) => task[side].connectionName || task[side].connectionId || fallback;

export const DataSyncTaskList: React.FC<{
  id?: string;
  containerRef?: React.Ref<HTMLElement>;
  tasks: DataSyncTaskDefinition[];
  selectedTaskId: string;
  search: string;
  t: DataSyncWorkbenchTranslate;
  onSearchChange: (value: string) => void;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onClose?: () => void;
}> = ({
  id,
  containerRef,
  tasks,
  selectedTaskId,
  search,
  t,
  onSearchChange,
  onSelectTask,
  onNewTask,
  onClose,
}) => (
  <aside
    ref={containerRef}
    id={id}
    className="gn-data-sync-task-list"
    aria-label={t('task_list.title')}
  >
    <div className="gn-data-sync-task-list__header">
      <strong>{t('task_list.title')}</strong>
      <span className="gn-data-sync-task-list__header-actions">
        <button
          type="button"
          className="gn-data-sync-icon-button"
          aria-label={t('workbench.new_task')}
          title={t('workbench.new_task')}
          onClick={onNewTask}
        >
          +
        </button>
        {onClose ? (
          <button
            type="button"
            className="gn-data-sync-icon-button gn-data-sync-task-list__close"
            aria-label={t('common.dismiss')}
            title={t('common.dismiss')}
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </span>
    </div>
    <label className="gn-data-sync-search">
      <span className="gn-data-sync-visually-hidden">{t('task_list.search')}</span>
      <input
        value={search}
        placeholder={t('task_list.search')}
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </label>
    <div className="gn-data-sync-task-list__items">
      {tasks.length === 0 ? (
        <div className="gn-data-sync-task-list__empty">{t('task_list.empty')}</div>
      ) : (
        tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className="gn-data-sync-task-row"
            data-task-id={task.id}
            data-selected={task.id === selectedTaskId ? 'true' : 'false'}
            aria-current={task.id === selectedTaskId ? 'true' : undefined}
            onClick={() => onSelectTask(task.id)}
          >
            <span className="gn-data-sync-task-row__marker" aria-hidden="true" />
            <span className="gn-data-sync-task-row__content">
              <span className="gn-data-sync-task-row__name">
                {task.name || t(dataSyncTaskKindTextKey(task))}
              </span>
              <span className="gn-data-sync-task-row__route">
                {endpointName(task, 'source', t('route.pending_source'))}
                <span aria-hidden="true">→</span>
                {task.kind === 'backup' ? task.backup?.directory || t('stage.backup_output') : endpointName(task, 'target', t('route.pending_target'))}
              </span>
              <span className="gn-data-sync-task-row__meta">
                {t(dataSyncTaskKindTextKey(task))} ·{' '}
                {t('task_list.revision', { revision: task.revision })}
              </span>
            </span>
            <span
              className="gn-data-sync-state-label"
              data-state={task.lifecycle}
            >
              {t(`task_list.lifecycle.${task.lifecycle}`)}
            </span>
          </button>
        ))
      )}
    </div>
  </aside>
);

const FALLBACK_KIND_CHOICES: readonly DataSyncTaskKindChoice[] = [
  { kind: 'backup' },
  { kind: 'migration' },
  { kind: 'reconcile' },
  { kind: 'querySink' },
  { kind: 'compare' },
  { kind: 'cdc' },
];

const kindChoiceKey = (choice: DataSyncTaskKindChoice) =>
  choice.compareMode ? `${choice.kind}:${choice.compareMode}` : choice.kind;

const kindChoiceDescKey = (choice: DataSyncTaskKindChoice): DataSyncWorkbenchTextKey =>
  choice.kind === 'compare' && choice.compareMode
    ? (`task_kind.compare_${choice.compareMode}_desc` as DataSyncWorkbenchTextKey)
    : (`task_kind.${choice.kind}_desc` as DataSyncWorkbenchTextKey);

export const DataSyncTaskKindSelector: React.FC<{
  t: DataSyncWorkbenchTranslate;
  family?: DataSyncWorkbenchFamily;
  onSelect: (kind: DataSyncTaskKind, compareMode?: DataSyncCompareMode) => void;
}> = ({ t, family, onSelect }) => {
  const choices = family ? DATA_SYNC_FAMILY_KIND_CHOICES[family] : FALLBACK_KIND_CHOICES;
  return (
    <section
      className="gn-data-sync-kind-selector"
      data-data-sync-kind-selector="true"
      data-workbench-family={family || ''}
    >
      <header>
        <h2>{t('task_kind.title')}</h2>
        <p>{t(family === 'compare' ? 'task_kind.subtitle_compare' : 'task_kind.subtitle')}</p>
      </header>
      <div className="gn-data-sync-kind-table" role="list">
        {choices.map((choice) => (
          <button
            key={kindChoiceKey(choice)}
            type="button"
            role="listitem"
            className="gn-data-sync-kind-row"
            data-task-kind={choice.kind}
            data-compare-mode={choice.compareMode || ''}
            onClick={() => onSelect(choice.kind, choice.compareMode)}
          >
            <span className="gn-data-sync-kind-row__arrow" aria-hidden="true">→</span>
            <span>
              <strong>{t(dataSyncTaskKindChoiceTextKey(choice))}</strong>
              <small>{t(kindChoiceDescKey(choice))}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
