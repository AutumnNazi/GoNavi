import { tableHasCompareDiff } from './compareRepairSql';
import { DataSyncCompareRow } from './DataSyncCompareRow';
import { RunEventTimeline } from './DataSyncRunEventTimeline';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';

export function DataSyncRunCompare(props: DataSyncRunHistoryProps) {
  const { selectedRunId, runEvents, compareResult, compareMode, t, onGenerateRepairSql, onAskAiAboutDiffs, onSyncDiffs } = props;
  const isCompareWorkbench = props.family === 'compare';
  const compareDetailOpen = isCompareWorkbench && Boolean(selectedRunId);
  return <>
    {(!isCompareWorkbench && compareResult) || compareDetailOpen ? (
      <section className="gn-data-sync-compare-panel" data-data-sync-compare="true">
        <h2>{t('compare.title')}</h2>
        {isCompareWorkbench &&
          compareResult &&
          compareResult.tables.some((summary) =>
            tableHasCompareDiff(summary, compareResult.content || compareMode),
          ) ? (
          <div className="gn-data-sync-compare-toolbar">
            {onGenerateRepairSql ? (
              <button
                type="button"
                className="gn-data-sync-button"
                data-compare-action="repair-sql"
                onClick={onGenerateRepairSql}
              >
                {t('compare.actions.repair_sql')}
              </button>
            ) : null}
            {onAskAiAboutDiffs ? (
              <button
                type="button"
                className="gn-data-sync-button"
                data-compare-action="ai-sql"
                onClick={onAskAiAboutDiffs}
              >
                {t('compare.actions.ai_sql')}
              </button>
            ) : null}
            {onSyncDiffs ? (
              <button
                type="button"
                className="gn-data-sync-button gn-data-sync-button--primary"
                data-compare-action="sync-diff"
                onClick={onSyncDiffs}
              >
                {t('compare.actions.sync_diff')}
              </button>
            ) : null}
          </div>
        ) : null}
        {isCompareWorkbench ? (
          <details className="gn-data-sync-run-events gn-data-sync-run-events--secondary" data-data-sync-run-events="true">
            <summary>{t('events.title_secondary')}</summary>
            {runEvents.length === 0 ? (
              <p>{t('events.empty')}</p>
            ) : (
              <RunEventTimeline key={selectedRunId} events={runEvents.filter((event) => event.runId === selectedRunId)} t={t} history={props} />
            )}
          </details>
        ) : null}
        {!selectedRunId || !compareResult ? (
          <p>{t('compare.empty')}</p>
        ) : compareResult.tables.length === 0 ? (
          <p>{compareResult.message || t('compare.empty')}</p>
        ) : (
          <ul className="gn-data-sync-compare-list">
            {compareResult.tables.map((summary) => <DataSyncCompareRow key={summary.table}
              summary={summary} compareMode={compareResult.content || compareMode} t={t} />)}
          </ul>
        )}
      </section>
    ) : null}
  </>;
}
