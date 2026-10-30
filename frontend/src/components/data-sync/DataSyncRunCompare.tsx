import { useMemo, useState } from 'react';
import { tableHasCompareDiff } from './compareRepairSql';
import { DataSyncCompareFilters } from './DataSyncCompareFilters';
import { DataSyncCompareRow } from './DataSyncCompareRow';
import { DataSyncCompareSummary } from './DataSyncCompareSummary';
import { RunEventTimeline } from './DataSyncRunEventTimeline';
import type {
  CompareRiskBucket,
  CompareTableFilter,
} from './dataSyncCompareSummaryModel';
import {
  buildCompareSummary,
  filterCompareTables,
} from './dataSyncCompareSummaryModel';
import type {
  CompareHtmlExportOutcome,
  DataSyncRunHistoryProps,
} from './dataSyncRunHistoryTypes';

type ExportNotice = { tone: 'ok' | 'error'; text: string } | null;

export function DataSyncRunCompare(props: DataSyncRunHistoryProps) {
  const { selectedRunId, runEvents, compareResult, compareMode, t, onGenerateRepairSql, onAskAiAboutDiffs, onSyncDiffs, onExportCompareHtml } = props;
  const isCompareWorkbench = props.family === 'compare';
  const compareDetailOpen = isCompareWorkbench && Boolean(selectedRunId);
  // 筛选只影响明细列表；KPI 与分布始终按完整结果统计，避免筛选后指标跳变。
  const [filter, setFilter] = useState<CompareTableFilter>('all');
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<CompareRiskBucket[]>([]);
  // 导出结果就地反馈：成功给出落盘路径，取消保持静默。
  const [exportNotice, setExportNotice] = useState<ExportNotice>(null);
  const runExport = async (action: () => Promise<CompareHtmlExportOutcome>) => {
    const outcome = await action();
    if (outcome.kind === 'saved') {
      setExportNotice({
        tone: 'ok',
        text: t('compare.export.success', { path: outcome.path }),
      });
    } else if (outcome.kind === 'failed') {
      setExportNotice({
        tone: 'error',
        text: t('compare.export.failed', { error: outcome.error }),
      });
    }
  };
  const effectiveMode = compareResult?.content || compareMode;
  const summary = useMemo(
    () => buildCompareSummary(compareResult, compareMode),
    [compareResult, compareMode],
  );
  const visibleTables = useMemo(
    () => filterCompareTables(
      compareResult?.tables || [],
      effectiveMode,
      filter,
      query,
      riskFilter,
      t,
    ),
    [compareResult, effectiveMode, filter, query, riskFilter, t],
  );
  return <>
    {(!isCompareWorkbench && compareResult) || compareDetailOpen ? (
      <section className="gn-data-sync-compare-panel" data-data-sync-compare="true">
        <h2>{t('compare.title')}</h2>
        {isCompareWorkbench &&
          compareResult &&
          (onExportCompareHtml || compareResult.tables.some((row) =>
            tableHasCompareDiff(row, compareResult.content || compareMode),
          )) ? (
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
            {onExportCompareHtml ? (
              <button
                type="button"
                className="gn-data-sync-button"
                data-compare-action="export-html"
                onClick={() => void runExport(onExportCompareHtml)}
              >
                {t('compare.actions.export_html')}
              </button>
            ) : null}
          </div>
        ) : null}
        {exportNotice ? (
          <p
            className="gn-data-sync-inline-note"
            data-tone={exportNotice.tone}
            data-data-sync-compare-export-notice={exportNotice.tone}
            role={exportNotice.tone === 'error' ? 'alert' : 'status'}
          >
            {exportNotice.text}
          </p>
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
          <>
            <DataSyncCompareSummary summary={summary} t={t} />
            <DataSyncCompareFilters
              summary={summary}
              filter={filter}
              query={query}
              riskFilter={riskFilter}
              visibleCount={visibleTables.length}
              onFilterChange={setFilter}
              onQueryChange={setQuery}
              onRiskFilterChange={setRiskFilter}
              t={t}
            />
            {visibleTables.length === 0 ? (
              <p className="gn-data-sync-compare-empty-filter" data-data-sync-compare-empty-filter="true">
                {t('compare.filters.empty')}
              </p>
            ) : (
              <ul className="gn-data-sync-compare-list">
                {visibleTables.map((row) => <DataSyncCompareRow key={row.table}
                  summary={row} compareMode={effectiveMode} t={t} />)}
              </ul>
            )}
          </>
        )}
      </section>
    ) : null}
  </>;
}
