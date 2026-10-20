import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import { formatDataSyncTime } from './dataSyncRunTime';

const canDeleteRunHistory = (status: string) => ['succeeded', 'partial', 'failed', 'canceled', 'cancelled', 'interrupted'].includes(status);

export function DataSyncRunHistoryRows(props: DataSyncRunHistoryProps) {
  const { runs, selectedRunId, busyAction, t, onSelectRun, onCancel, onResume, onRetry, onRollback, onDeleteRun } = props;
  const isCompareWorkbench = props.family === 'compare';
  return (
    <table className="gn-data-sync-history-table">
      <thead>
        <tr>
          <th>{t('runs.id')}</th>
          <th>{t('runs.task')}</th>
          <th>{t('runs.status')}</th>
          <th>{t('runs.started_at')}</th>
          {isCompareWorkbench ? null : (
            <>
              <th>{t('runs.rows_written')}</th>
              <th>{t('runs.rows_failed')}</th>
              <th>{t('runs.checkpoint')}</th>
            </>
          )}
          <th>{t('runs.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} data-selected={run.id === selectedRunId ? 'true' : 'false'}>
            <td className="gn-data-sync-mono">{run.id}</td>
            <td>{run.taskName}</td>
            <td>
              <span className="gn-data-sync-state-label" data-state={run.status}>
                {t(`status.${run.status}`)}
              </span>
            </td>
            <td>{formatDataSyncTime(run.startedAt)}</td>
            {isCompareWorkbench ? null : (
              <>
                <td>{run.rowsWritten.toLocaleString()}</td>
                <td>{run.rowsFailed.toLocaleString()}</td>
                <td className="gn-data-sync-mono">{run.checkpoint || '—'}</td>
              </>
            )}
            <td>
              <button
                type="button"
                className="gn-data-sync-link-button"
                onClick={() => onSelectRun(run.id)}
              >
                {t('runs.view_details')}
              </button>
              {run.status === 'queued' || run.status === 'running' ? (
                <button
                  type="button"
                  className="gn-data-sync-link-button"
                  disabled={busyAction === `cancel:${run.id}`}
                  onClick={() => onCancel(run.id)}
                >
                  {t('runs.cancel')}
                </button>
              ) : null}
              {run.resumable ? (
                <button
                  type="button"
                  className="gn-data-sync-link-button"
                  disabled={busyAction === `resume:${run.id}`}
                  onClick={() => onResume(run.id)}
                >
                  {t('runs.resume')}
                </button>
              ) : null}
              {['failed', 'partial', 'canceled', 'cancelled', 'interrupted'].includes(
                run.status,
              ) ? (
                <button
                  type="button"
                  className="gn-data-sync-link-button"
                  disabled={busyAction === `retry:${run.id}`}
                  onClick={() => onRetry(run.id)}
                >
                  {t('runs.retry')}
                </button>
              ) : null}
              {run.rollbackReady && canDeleteRunHistory(run.status) && onRollback ? (
                <button type="button" className="gn-data-sync-link-button" data-data-sync-rollback-run={run.id} disabled={busyAction === `rollback-run:${run.id}`} onClick={() => onRollback(run.id)}>
                  {t('runs.rollback')}
                </button>
              ) : null}
              {canDeleteRunHistory(run.status) ? (
                <button
                  type="button"
                  className="gn-data-sync-link-button gn-data-sync-link-button--danger"
                  disabled={busyAction === `delete-run:${run.id}`}
                  onClick={() => onDeleteRun(run.id)}
                >
                  {t('runs.delete')}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
