import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import { formatDataSyncTime } from './dataSyncRunTime';

export function DataSyncRunCheckpoint(props: DataSyncRunHistoryProps) {
  const { selectedRunId, checkpoint, busyAction, t, checkpointResetEnabled, onResetCheckpoint } = props;
  const isCompareWorkbench = props.family === 'compare';
  return <>
    {isCompareWorkbench ? null : (
      <section className="gn-data-sync-checkpoint-panel" data-data-sync-checkpoint="true">
        <h2>{t('checkpoint.title')}</h2>
        {!selectedRunId || !checkpoint ? (
          <p>{t('checkpoint.empty')}</p>
        ) : (
          <dl>
            <div><dt>{t('checkpoint.kind')}</dt><dd>{checkpoint.kind || '—'}</dd></div>
            <div><dt>{t('checkpoint.phase')}</dt><dd>{checkpoint.phase || '—'}</dd></div>
            <div><dt>{t('checkpoint.updated_at')}</dt><dd>{formatDataSyncTime(checkpoint.updatedAt)}</dd></div>
            <div><dt>{t('checkpoint.cursor')}</dt><dd><code>{checkpoint.cursorPreview || '—'}</code></dd></div>
          </dl>
        )}
        <button
          type="button"
          className="gn-data-sync-button gn-data-sync-button--danger"
          disabled={
            !checkpoint ||
            !checkpointResetEnabled ||
            busyAction === 'reset-checkpoint'
          }
          onClick={onResetCheckpoint}
        >
          {t('checkpoint.reset')}
        </button>
        <p>{t('checkpoint.reset_warning')}</p>
      </section>
    )}  </>;
}
