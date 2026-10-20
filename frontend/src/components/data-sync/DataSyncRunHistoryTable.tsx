import React from 'react';
import { DataSyncRunHistoryRows } from './DataSyncRunHistoryRows';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import type { DataSyncRunPageSize } from './model';
import { DATA_SYNC_RUN_PAGE_SIZES } from './model';


export function DataSyncRunHistoryTable(props: DataSyncRunHistoryProps) {
  const { runs, runPage, runPageSize, runTotal, hasPreviousRunPage, hasNextRunPage, busyAction, t, onPreviousRunPage, onNextRunPage, onRunPageSizeChange } = props;
  return (
    <>
      <div
        className="gn-data-sync-table-scroll"
        // 翻页时行数变少（末页），高度若随内容走，表格和下面的分页控件
        // 会整体上跳一截，用户刚点过的按钮位置就变了。按当前页大小预留
        // 满页高度，翻页只换行、不搬位置。行高与表头高度见 CSS 中的
        // .gn-data-sync-history-table 规则。
        style={
          {
            '--gn-ds-run-page-rows': String(runPageSize),
          } as React.CSSProperties
        }
      >
        <DataSyncRunHistoryRows {...props} />
      </div>
      <nav className="gn-data-sync-run-pagination" aria-label={t('runs.pagination')}>
        <div className="gn-data-sync-run-pagination__summary">
          <span>{t('runs.page', { page: runPage })}</span>
          <span>{t('runs.total', { total: runTotal.toLocaleString() })}</span>
        </div>
        <label className="gn-data-sync-run-pagination__size">
          <span>{t('runs.page_size')}</span>
          <select
            className="gn-data-sync-control"
            value={runPageSize}
            disabled={busyAction === 'page-runs'}
            onChange={(event) =>
              onRunPageSizeChange(Number(event.target.value) as DataSyncRunPageSize)
            }
          >
            {DATA_SYNC_RUN_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="gn-data-sync-button"
          disabled={!hasPreviousRunPage || busyAction === 'page-runs'}
          onClick={onPreviousRunPage}
        >
          {t('runs.previous_page')}
        </button>
        <button
          type="button"
          className="gn-data-sync-button"
          disabled={!hasNextRunPage || busyAction === 'page-runs'}
          onClick={onNextRunPage}
        >
          {t('runs.next_page')}
        </button>
      </nav>
    </>
  );
}
