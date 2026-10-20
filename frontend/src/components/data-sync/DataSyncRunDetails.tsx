import { DataSyncRunCheckpoint } from './DataSyncRunCheckpoint';
import { DataSyncRunCompare } from './DataSyncRunCompare';
import { RunEventTimeline } from './DataSyncRunEventTimeline';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';

export function DataSyncRunDetails(props: DataSyncRunHistoryProps) {
  const { selectedRunId, runEvents, t } = props;
  const isCompareWorkbench = props.family === 'compare';
  return <>
    {isCompareWorkbench ? null : (
      <section className="gn-data-sync-run-events" data-data-sync-run-events="true">
        <h2>{t('events.title')}</h2>
        {!selectedRunId ? (
          <p>{t('events.select_run')}</p>
        ) : runEvents.length === 0 ? (
          <p>{t('events.empty')}</p>
        ) : (
          <RunEventTimeline key={selectedRunId} events={runEvents.filter((event) => event.runId === selectedRunId)} t={t} history={props} />
        )}
      </section>
    )}

    <DataSyncRunCompare {...props} />
    <DataSyncRunCheckpoint {...props} />

  </>;
}
