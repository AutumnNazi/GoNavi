import { describeCompareRow } from './dataSyncCompareRowModel';
import type { DataSyncCompareMode, DataSyncTableDiffSummary } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
type Props = { summary: DataSyncTableDiffSummary; compareMode?: DataSyncCompareMode; t: DataSyncWorkbenchTranslate };
export function DataSyncCompareRowCounts({ summary, compareMode, t }: Props) {
  const { showData, status } = describeCompareRow(summary, compareMode);
  return <>
    {/* Identical tables are the bulk of a compare run and used to
                    spend a four-tile grid on 0/0/0/N. The badge already says
                    they match, so keep one inline count on the single row. */}
    {showData && status !== 'same' ? (
      <dl className="gn-data-sync-compare-row__data-counts">
        <div data-kind="inserts">
          <dt>{t('compare.inserts')}</dt>
          <dd>{summary.inserts.toLocaleString()}</dd>
        </div>
        <div data-kind="updates">
          <dt>{t('compare.updates')}</dt>
          <dd>{summary.updates.toLocaleString()}</dd>
        </div>
        <div data-kind="deletes">
          <dt>{t('compare.deletes')}</dt>
          <dd>{summary.deletes.toLocaleString()}</dd>
        </div>
        <div data-kind="same">
          <dt>{t('compare.same')}</dt>
          <dd>{summary.same.toLocaleString()}</dd>
        </div>
      </dl>
    ) : null}
    {showData && status === 'same' ? (
      <span
        className="gn-data-sync-compare-row__same-count"
        data-data-sync-compare-same-count="true"
      >
        {t('compare.same_rows', { count: summary.same.toLocaleString() })}
      </span>
    ) : null}

  </>;
}
