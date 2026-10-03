import React from 'react';
import { TriggerStage } from './DataSyncTaskEditor';
import { DataSyncBackupSource } from './DataSyncBackupSource';
import { DataSyncBackupObjects } from './DataSyncBackupObjects';
import { DataSyncBackupOutput } from './DataSyncBackupOutput';
import { DataSyncPreflightPanel } from './DataSyncPreflightPanel';
import { dataSyncTaskStages } from './model';
import { dataSyncStageTextKey } from './text';
import type { DataSyncBackupEditorProps } from './dataSyncBackupEditorProps';
import './DataSyncBackupEditor.css';

export const DataSyncBackupEditor: React.FC<DataSyncBackupEditorProps> = (props) => {
  const { task, activeStage, onStageChange, t, preflightContent, preflight, preflightStale } = props;
  return <div className="gn-data-sync-task-editor" data-backup-editor="true">
    <nav className="gn-data-sync-stage-nav" aria-label={t('workbench.task_steps')}>
      {dataSyncTaskStages(task.kind).map((stage, index) => <button key={stage} className="gn-data-sync-stage-nav__step"
        data-active={activeStage === stage ? 'true' : 'false'} data-stage={stage} aria-current={activeStage === stage ? 'step' : undefined} onClick={() => onStageChange(stage)}>
        <span className="gn-data-sync-stage-nav__node">{index + 1}</span>
        <span className="gn-data-sync-stage-nav__label">{t(dataSyncStageTextKey(stage, task.kind))}</span>
      </button>)}
    </nav>
    <div className="gn-data-sync-task-editor__body">
      {activeStage === 'endpoints' ? <DataSyncBackupSource {...props} /> : null}
      {activeStage === 'mappings' ? <DataSyncBackupObjects {...props} /> : null}
      {activeStage === 'delivery' ? <DataSyncBackupOutput {...props} /> : null}
      {activeStage === 'trigger' ? <TriggerStage {...props} /> : null}
      {activeStage === 'preflight' ? preflightContent || <DataSyncPreflightPanel snapshot={preflight}
        currentRevision={task.revision} stale={preflightStale} running={false} t={t} onLocateIssue={onStageChange} /> : null}
    </div>
  </div>;
};
