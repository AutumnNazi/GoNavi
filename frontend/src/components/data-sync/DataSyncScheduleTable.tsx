import React from 'react';

import type { DataSyncScheduleSummary } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
import { EmptyState, formatDataSyncTime } from './DataSyncOperationalViews';
import './DataSyncScheduleTable.css';

/**
 * Read/act view over the aggregated schedule rows: per-row lifecycle toggle,
 * immediate run, and a shortcut into the latest run's history. All actions
 * freeze while any schedule operation is in flight (busyAction non-empty) so
 * two rows can never race the same authoritative snapshot.
 */
export const DataSyncScheduleTable: React.FC<{
  schedules: DataSyncScheduleSummary[];
  t: DataSyncWorkbenchTranslate;
  refreshing: boolean;
  busyAction: string;
  onRefresh: () => void;
  onToggle?: (schedule: DataSyncScheduleSummary) => void;
  onRunNow?: (schedule: DataSyncScheduleSummary) => void;
  onViewRun?: (runId: string) => void;
}> = ({
  schedules,
  t,
  refreshing,
  busyAction,
  onRefresh,
  onToggle,
  onRunNow,
  onViewRun,
}) => {
  const frozen = Boolean(busyAction);
  return (
    <section className="gn-data-sync-operational-view" data-data-sync-schedules="true">
      <header className="gn-data-sync-view-heading">
        <h1>{t('schedules.title')}</h1>
        <div>
          <p>{t('schedules.subtitle')}</p>
          <button
            type="button"
            className="gn-data-sync-button"
            disabled={frozen || refreshing}
            onClick={onRefresh}
          >
            {t('common.refresh')}
          </button>
        </div>
      </header>
      {schedules.length === 0 ? (
        <EmptyState
          title={t('schedules.empty_title')}
          description={t('schedules.empty_desc')}
        />
      ) : (
        <div
          className="gn-data-sync-schedule-table"
          role="table"
          aria-label={t('schedules.title')}
        >
          <div className="gn-data-sync-schedule-table__head" role="row">
            <span role="columnheader">{t('schedules.task')}</span>
            <span role="columnheader">{t('schedules.status')}</span>
            <span role="columnheader">{t('schedules.trigger')}</span>
            <span role="columnheader">{t('schedules.next_run')}</span>
            <span role="columnheader">{t('schedules.latest_run')}</span>
            <span role="columnheader">{t('schedules.actions')}</span>
          </div>
          {schedules.map((schedule) => {
            const latest = schedule.latestRun;
            return (
              <div
                key={schedule.id}
                className="gn-data-sync-schedule-table__row"
                role="row"
                data-task-id={schedule.taskId}
                data-enabled={schedule.enabled ? 'true' : 'false'}
              >
                <div role="cell" className="gn-data-sync-schedule-table__task">
                  <span
                    className="gn-data-sync-summary-list__signal"
                    data-active={schedule.enabled}
                    aria-hidden="true"
                  />
                  <strong>{schedule.taskName}</strong>
                </div>
                <div role="cell">
                  <span
                    className="gn-data-sync-schedule-table__state"
                    data-enabled={schedule.enabled ? 'true' : 'false'}
                  >
                    {schedule.enabled ? t('schedules.enabled') : t('schedules.disabled')}
                  </span>
                </div>
                <div role="cell">
                  <code>{schedule.expression}</code>
                  <small>{schedule.timezone}</small>
                </div>
                <div role="cell">
                  <time>
                    {schedule.nextRunAt
                      ? formatDataSyncTime(schedule.nextRunAt)
                      : '—'}
                  </time>
                </div>
                <div role="cell" className="gn-data-sync-schedule-table__latest">
                  {latest ? (
                    <>
                      <span
                        className="gn-data-sync-state-label"
                        data-state={latest.status}
                      >
                        {t(`status.${latest.status}`)}
                      </span>
                      <small>
                        {formatDataSyncTime(latest.startedAt)}
                        {' → '}
                        {formatDataSyncTime(latest.finishedAt)}
                      </small>
                      {latest.errorSummary ? (
                        <span
                          className="gn-data-sync-schedule-table__error"
                          title={latest.errorSummary}
                        >
                          {latest.errorSummary}
                        </span>
                      ) : null}
                      {onViewRun ? (
                        <button
                          type="button"
                          className="gn-data-sync-link-button"
                          onClick={() => onViewRun(latest.id)}
                        >
                          {t('schedules.view_run')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <small>{t('schedules.no_runs')}</small>
                  )}
                </div>
                <div role="cell" className="gn-data-sync-schedule-table__actions">
                  {onToggle ? (
                    <button
                      type="button"
                      className="gn-data-sync-button"
                      disabled={frozen}
                      onClick={() => onToggle(schedule)}
                    >
                      {schedule.enabled ? t('schedules.disable') : t('schedules.enable')}
                    </button>
                  ) : null}
                  {onRunNow ? (
                    <button
                      type="button"
                      className="gn-data-sync-button gn-data-sync-button--primary"
                      disabled={frozen || schedule.lifecycle === 'paused'}
                      title={
                        schedule.lifecycle === 'paused'
                          ? t('schedules.disabled')
                          : undefined
                      }
                      onClick={() => onRunNow(schedule)}
                    >
                      {t('schedules.run_now')}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
