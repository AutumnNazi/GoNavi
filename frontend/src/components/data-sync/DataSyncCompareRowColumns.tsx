import type { DataSyncCompareMode, DataSyncTableDiffSummary } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
type Props = { summary: DataSyncTableDiffSummary; compareMode?: DataSyncCompareMode; t: DataSyncWorkbenchTranslate };
export function DataSyncCompareRowColumns({ summary, t }: Props) {
  const columnDiffs = summary.columnDiffs || [];
  return (
    <ul
      className="gn-data-sync-compare-row__column-diffs"
      data-data-sync-column-diffs="true"
    >
      {columnDiffs.map((diff) => (
        <li key={`${diff.kind}:${diff.column}`} data-kind={diff.kind}>
          {/* Kind leads so the line reads as a sentence in both
                            locales ("目标缺失 new_column varchar(255)"). */}
          <span className="gn-data-sync-compare-row__diff-kind">
            {t(`compare.diff_kind.${diff.kind}`)}
          </span>
          <span
            className="gn-data-sync-compare-row__field"
            data-data-sync-compare-field="true"
          >
            <code className="gn-data-sync-mono">{diff.column}</code>
            {diff.kind !== 'type' &&
              diff.kind !== 'nullable' &&
              (diff.source || diff.target) && (
                <code className="gn-data-sync-mono gn-data-sync-compare-row__field-type">
                  {diff.source || diff.target}
                </code>
              )}
          </span>
          {diff.kind === 'type' || diff.kind === 'nullable' ? (
            <span className="gn-data-sync-compare-row__diff-detail">
              <code className="gn-data-sync-mono">
                {diff.source || '—'}
              </code>
              {' → '}
              <code className="gn-data-sync-mono">
                {diff.target || '—'}
              </code>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
