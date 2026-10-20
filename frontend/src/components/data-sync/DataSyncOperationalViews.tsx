import React from 'react';
import { DataSyncRunHistoryTable } from './DataSyncRunHistoryTable';

import { DataSyncRunDetailsModal } from './DataSyncRunDetailsModal';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import type {
  DataSyncCdcSourceStatus,
  DataSyncRunRecord
} from './model';
import type { DataSyncWorkbenchTranslate } from './text';
export { formatDataSyncTime } from './dataSyncRunTime';

export const EmptyState: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div className="gn-data-sync-empty">
    <span className="gn-data-sync-empty__mark" aria-hidden="true">∅</span>
    <strong>{title}</strong>
    <p>{description}</p>
  </div>
);

const formatCdcLag = (
  lagMs: number | null,
  t: DataSyncWorkbenchTranslate,
): string =>
  lagMs === null
    ? t('cdc.lag_unknown')
    : `${Math.max(0, lagMs).toLocaleString()} ms`;

const canDeleteRunHistory = (status: DataSyncRunRecord['status']): boolean =>
  ['succeeded', 'partial', 'failed', 'canceled', 'cancelled', 'interrupted'].includes(
    status,
  );

export const DataSyncRunHistory: React.FC<DataSyncRunHistoryProps> = (props) => {
  const { runs, family, busyAction, t, onRefresh, onClearTerminalRuns } = props;
  const isCompareWorkbench = family === 'compare';
  return (
    <section className="gn-data-sync-operational-view" data-data-sync-run-history="true">
      <header className="gn-data-sync-view-heading">
        <h1>{t('runs.title')}</h1>
        <div>
          <p>{t(isCompareWorkbench ? 'runs.subtitle_compare' : 'runs.subtitle')}</p>
          <button
            type="button"
            className="gn-data-sync-button"
            disabled={busyAction === 'refresh-runs'}
            onClick={onRefresh}
          >
            {t('common.refresh')}
          </button>
          <button
            type="button"
            className="gn-data-sync-button gn-data-sync-button--danger"
            disabled={
              !runs.some((run) => canDeleteRunHistory(run.status)) ||
              busyAction === 'clear-runs'
            }
            onClick={onClearTerminalRuns}
          >
            {t('runs.clear_terminal')}
          </button>
        </div>
      </header>
      {runs.length === 0 ? (
        <EmptyState
          title={t('runs.empty_title')}
          description={t(isCompareWorkbench ? 'runs.empty_desc_compare' : 'runs.empty_desc')}
        />
      ) : (
        <DataSyncRunHistoryTable {...props} />
      )}

      <DataSyncRunDetailsModal {...props} />
    </section>
  );
};

export const DataSyncCdcView: React.FC<{
  sources: DataSyncCdcSourceStatus[];
  t: DataSyncWorkbenchTranslate;
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ sources, t, refreshing, onRefresh }) => (
  <section className="gn-data-sync-operational-view" data-data-sync-cdc="true">
    <header className="gn-data-sync-view-heading">
      <h1>{t('cdc.title')}</h1>
      <div>
        <p>{t('cdc.subtitle')}</p>
        <button type="button" className="gn-data-sync-button" disabled={refreshing} onClick={onRefresh}>
          {t('common.refresh')}
        </button>
      </div>
    </header>
    {sources.length === 0 ? (
      <EmptyState
        title={t('cdc.empty_title')}
        description={t('cdc.empty_desc')}
      />
    ) : (
      <ul className="gn-data-sync-summary-list">
        {sources.map((source) => (
          <li key={source.taskId || source.connectionId}>
            <span className="gn-data-sync-summary-list__signal" data-state={source.status} />
            <strong>{source.connectionName}</strong>
            <code>{source.adapter || source.type}</code>
            <span>{formatCdcLag(source.lagMs, t)}</span>
            <code>{source.checkpoint || '—'}</code>
            <span>{source.reason || t(`cdc.status.${source.status}`)}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);
