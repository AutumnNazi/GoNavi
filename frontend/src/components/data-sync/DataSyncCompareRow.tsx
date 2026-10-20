import { DataSyncCompareRowCounts } from './DataSyncCompareRowCounts';
import { describeCompareRow } from './dataSyncCompareRowModel';
import { DataSyncCompareRowSchema } from './DataSyncCompareRowSchema';
import type { DataSyncCompareMode, DataSyncTableDiffSummary } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
type Props = { summary: DataSyncTableDiffSummary; compareMode?: DataSyncCompareMode; t: DataSyncWorkbenchTranslate };
export function DataSyncCompareRow({ summary, compareMode, t }: Props) {
  const { notCompared, hasDiff, status, message, warnings } = describeCompareRow(summary, compareMode);
  return (
    <li
      key={summary.table}
      className="gn-data-sync-compare-row"
      data-diff={hasDiff ? 'true' : 'false'}
      data-status={status}
    >
      <div className="gn-data-sync-compare-row__head">
        <span
          className="gn-data-sync-compare-badge"
          data-diff={hasDiff ? 'true' : 'false'}
          data-status={status}
        >
          {notCompared
            ? t('compare.status_blocked')
            : hasDiff
              ? t('compare.status_diff')
              : t('compare.status_same')}
        </span>
        <code className="gn-data-sync-mono">{summary.table}</code>
      </div>
      {/* The backend explains per-table outcomes only through
                    Message/Warnings; dropping them left failures invisible. */}
      {message && (
        <p
          className="gn-data-sync-compare-row__message"
          data-data-sync-compare-message="true"
          role={notCompared ? 'alert' : undefined}
        >
          {message}
        </p>
      )}
      {warnings.length > 0 && (
        <ul
          className="gn-data-sync-compare-row__warnings"
          data-data-sync-compare-warnings="true"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {status !== 'same' && (summary.sourceObject || summary.targetObject) && (
        <dl className="gn-data-sync-compare-row__endpoints">
          {summary.sourceObject && (
            <div data-side="source">
              <dt>{t('compare.source')}</dt>
              <dd className="gn-data-sync-mono">{summary.sourceObject}</dd>
            </div>
          )}
          {summary.targetObject && (
            <div data-side="target">
              <dt>{t('compare.target')}</dt>
              <dd className="gn-data-sync-mono">{summary.targetObject}</dd>
            </div>
          )}
        </dl>
      )}
      <DataSyncCompareRowSchema summary={summary} compareMode={compareMode} t={t} />
      <DataSyncCompareRowCounts summary={summary} compareMode={compareMode} t={t} />
    </li>

  );
}
