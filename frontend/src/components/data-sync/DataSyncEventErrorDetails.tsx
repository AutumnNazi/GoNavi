import { DataSyncRunErrors } from './DataSyncRunErrors';
import { resolveRunEventError } from './dataSyncEventErrors';
import type { DataSyncRunEvent } from './model';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';

export function DataSyncEventErrorDetails({ event, history }: {
  event: DataSyncRunEvent;
  history: DataSyncRunHistoryProps;
}) {
  const detail = resolveRunEventError(event, history.errorRows);
  const { t } = history;
  return <section data-event-error-details={event.sequence} aria-label={t('event_errors.details')}>
    <h3>{t('event_errors.details')}</h3>
    {detail.code ? <p data-event-error-code={detail.code}>{t('event_errors.code')}: <code>{detail.code}</code></p> : null}
    {detail.messages.map((message) => <p key={message} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</p>)}
    {detail.rows.length > 0 ? <>
      <p>{t(detail.runScope ? 'event_errors.run_scope' : 'event_errors.exact_scope')}</p>
      <DataSyncRunErrors {...history} family="sync" selectedRunMessage={undefined} errorRows={detail.rows} />
    </> : <p>{t('event_errors.no_rows')}</p>}
  </section>;
}
