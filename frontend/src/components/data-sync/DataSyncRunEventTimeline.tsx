import React, { useMemo, useState } from 'react';
import { formatDataSyncTime } from './dataSyncRunTime';
import { describeRunEvent, runEventPage, uniqueRunEvents } from './dataSyncRunTimeline';
import type { DataSyncRunEvent } from './model';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import { hasRunEventError } from './dataSyncEventErrors';
import { DataSyncEventErrorDetails } from './DataSyncEventErrorDetails';
import type { DataSyncWorkbenchTranslate } from './text';

export const RunEventTimeline: React.FC<{
  events: DataSyncRunEvent[];
  t: DataSyncWorkbenchTranslate;
  history?: DataSyncRunHistoryProps;
}> = ({ events, t, history }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const unique = useMemo(() => uniqueRunEvents(events), [events]);
  const visible = runEventPage(unique, page, pageSize);
  return <>
    <ol className="gn-data-sync-run-events__timeline">
      {visible.events.map((event) => {
        const description = describeRunEvent(event, t);
        const error = hasRunEventError(event);
        const identity = `${event.runId}:${event.sequence}`;
        const open = expanded === identity;
        return <li key={`${event.runId}:${event.sequence}`} data-event-sequence={event.sequence}>
          <div className="gn-data-sync-run-events__marker" aria-hidden="true" />
          <div className="gn-data-sync-run-events__content">
            <header><strong>{error ? t(`events.type.${event.type}`) : description.title}</strong><time>{formatDataSyncTime(event.createdAt)}</time></header>
            <p className="gn-data-sync-run-events__meta">
              {[`#${event.sequence}`, description.type, description.scope, description.count].filter(Boolean).join(' · ')}
            </p>
            {error && history ? <>
              <button type="button" className="gn-data-sync-link-button" data-view-event-error={event.sequence}
                aria-expanded={open} onClick={() => setExpanded(open ? null : identity)}>
                {t(open ? 'event_errors.hide' : 'event_errors.view')}
              </button>
              {open ? <DataSyncEventErrorDetails event={event} history={history} /> : null}
            </> : null}
          </div>
        </li>;
      })}
    </ol>
    <nav className="gn-data-sync-run-pagination" aria-label={t('events.title')}>
      <span>{t('runs.page', { page: visible.page })}</span>
      <span>{t('runs.total', { total: visible.total })}</span>
      <label className="gn-data-sync-run-pagination__size">
        <span>{t('runs.page_size')}</span>
        <select className="gn-data-sync-control" value={pageSize} onChange={(event) => {
          setPageSize(Number(event.target.value));
          setPage(1);
        }}>
          {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <button type="button" className="gn-data-sync-button" disabled={visible.page === 1}
        onClick={() => setPage(visible.page - 1)}>{t('runs.previous_page')}</button>
      <button type="button" className="gn-data-sync-button" disabled={visible.page === visible.pages}
        onClick={() => setPage(visible.page + 1)}>{t('runs.next_page')}</button>
    </nav>
  </>;
};
