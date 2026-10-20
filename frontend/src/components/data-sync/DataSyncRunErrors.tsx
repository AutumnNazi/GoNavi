import { EmptyState } from './DataSyncOperationalViews';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';

export function DataSyncRunErrors(props: DataSyncRunHistoryProps) {
  const { selectedRunId, selectedRunMessage, errorRows, busyAction, t, onDiscardErrorRow, errorRowRetryAvailable, onRetryErrorRow } = props;
  const isCompareWorkbench = props.family === 'compare';
  return <>
    {isCompareWorkbench ? null : (
      <section className="gn-data-sync-error-rows" data-data-sync-error-rows="true">
        <h2>{t('errors.title')}</h2>
        {!selectedRunId ? (
          <EmptyState
            title={t('errors.empty_title')}
            description={t('errors.empty_desc')}
          />
        ) : errorRows.length === 0 ? (
          selectedRunMessage ? (
            <div className="gn-data-sync-task-failure" data-data-sync-task-failure="true">
              <strong>{t('errors.task_failure_title')}</strong>
              <p>{selectedRunMessage}</p>
              <span>{t('errors.task_failure_desc')}</span>
            </div>
          ) : (
            <EmptyState
              title={t('errors.empty_title')}
              description={t('errors.empty_desc')}
            />
          )
        ) : (
          <div className="gn-data-sync-table-scroll">
            <table className="gn-data-sync-history-table">
              <thead>
                <tr>
                  <th>{t('errors.source')}</th>
                  <th>{t('errors.reason')}</th>
                  <th>{t('errors.payload')}</th>
                  <th>{t('errors.retryable')}</th>
                  <th>{t('runs.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {errorRows.map((row) => (
                  <tr key={row.id}>
                    <td className="gn-data-sync-mono">{row.sourceObject}</td>
                    <td>{row.reason}</td>
                    <td className="gn-data-sync-mono">{row.payloadPreview}</td>
                    <td>{t(row.retryable ? 'common.yes' : 'common.no')}</td>
                    <td>
                      <button
                        type="button"
                        className="gn-data-sync-link-button"
                        disabled={
                          !errorRowRetryAvailable ||
                          !row.retryable ||
                          row.status !== 'pending' ||
                          busyAction === `retry-row:${row.id}`
                        }
                        title={
                          errorRowRetryAvailable && row.retryable
                            ? ''
                            : t('errors.retry_unavailable')
                        }
                        onClick={() => onRetryErrorRow(row.id)}
                      >
                        {t('errors.retry')}
                      </button>
                      <button
                        type="button"
                        className="gn-data-sync-link-button gn-data-sync-link-button--danger"
                        disabled={
                          row.status === 'discarded' ||
                          busyAction === `discard:${row.id}`
                        }
                        onClick={() => onDiscardErrorRow(row.id)}
                      >
                        {row.status === 'discarded'
                          ? t('errors.discarded')
                          : t('errors.discard')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )}
  </>;
}
