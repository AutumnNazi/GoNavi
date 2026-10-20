import { DataSyncCompareRowColumns } from './DataSyncCompareRowColumns';
import { describeCompareRow } from './dataSyncCompareRowModel';
import type { DataSyncCompareMode, DataSyncTableDiffSummary } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
type Props = { summary: DataSyncTableDiffSummary; compareMode?: DataSyncCompareMode; t: DataSyncWorkbenchTranslate };
export function DataSyncCompareRowSchema({ summary, compareMode, t }: Props) {
  const { missingColumns, columnDiffs, showSchema, schemaWarningOnly, status } = describeCompareRow(summary, compareMode);
  return <>
    {/* Structure first: it is the coarser difference, and a row
                    count says little while a column gap is unresolved. */}
    {showSchema && status !== 'same' && (
      <dl className="gn-data-sync-compare-row__schema-counts">
        <div data-kind="schema">
          <dt>{t('compare.schema_diff')}</dt>
          <dd>
            {summary.schemaDiffCount === undefined
              ? '—'
              : summary.schemaDiffCount.toLocaleString()}
          </dd>
        </div>
      </dl>
    )}
    {schemaWarningOnly && (
      <p
        className="gn-data-sync-inline-note"
        role="note"
        data-data-sync-schema-warning="true"
      >
        {t('compare.schema_warning', {
          count: summary.schemaDiffCount ?? columnDiffs.length,
        })}
      </p>
    )}
    {showSchema &&
      (columnDiffs.length > 0 ? (
        <DataSyncCompareRowColumns summary={summary} t={t} />
      ) : (
        missingColumns.length > 0 && (
          <div className="gn-data-sync-compare-row__missing">
            <span className="gn-data-sync-compare-row__missing-label">
              {t('compare.missing_columns')}
            </span>
            {missingColumns.map((column) => (
              <code key={column} className="gn-data-sync-mono">
                {column}
              </code>
            ))}
          </div>
        )
      ))}

  </>;
}
