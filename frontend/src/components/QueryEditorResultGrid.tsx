import React from 'react';

import { filterColumnNamesByGlobalHiddenColumns, useGlobalHiddenColumns } from '../utils/globalHiddenColumns';
import { buildQueryResultColumnPinScope } from '../utils/queryResultColumnPinScope';
import DataGrid from './DataGrid';
import type { QueryEditorResultSet, QueryEditorResultViewState } from './QueryEditorResultsPanel';
import { FLUSH_QUERY_EDITOR_RESULT_VIEW_STATE_EVENT } from './queryEditor/queryEditorResultViewStateEvents';

const QUERY_EDITOR_RESULT_SCROLL_SNAPSHOT_PERSIST_DELAY_MS = 200;
const QUERY_EDITOR_RESULT_CELL_SELECTION_PERSIST_DELAY_MS = 200;

type QueryEditorResultGridProps = {
  result: QueryEditorResultSet;
  workbenchTabId?: string;
  isActive: boolean;
  loading: boolean;
  currentDb: string;
  currentConnectionId: string;
  maxRows?: number;
  dataPreviewRequest?: { resultKey: string; requestId: string } | null;
  toolbarExtraActions?: React.ReactNode;
  variant?: 'query' | 'elasticsearch';
  onReloadResult: (key: string, sql: string) => void | Promise<void>;
  onResultPageChange: (key: string, page: number, pageSize: number) => void | Promise<void>;
  onResultSort: (key: string, field: string, order: string) => void;
  onRequestResultTotalCount?: (key: string) => void;
  onCancelResultTotalCount?: (key: string) => void;
  onResultViewStateChange?: (key: string, patch: Partial<QueryEditorResultViewState>) => void;
};

const QueryEditorResultGrid: React.FC<QueryEditorResultGridProps> = ({
  result,
  workbenchTabId,
  isActive,
  loading,
  currentDb,
  currentConnectionId,
  maxRows,
  dataPreviewRequest,
  toolbarExtraActions,
  variant = 'query',
  onReloadResult,
  onResultPageChange,
  onResultSort,
  onRequestResultTotalCount,
  onCancelResultTotalCount,
  onResultViewStateChange,
}) => {
  const globalHiddenColumns = useGlobalHiddenColumns();
  const visibleColumns = filterColumnNamesByGlobalHiddenColumns(result.columns, globalHiddenColumns);
  const resolvedColumns = visibleColumns.length > 0 || result.columns.length === 0
    ? visibleColumns
    : result.columns;
  const isElasticsearch = variant === 'elasticsearch';
  const resultTableName = result.tableName;
  const updateViewState = React.useCallback((patch: Partial<QueryEditorResultViewState>) => {
    onResultViewStateChange?.(result.key, patch);
  }, [onResultViewStateChange, result.key]);
  const pendingScrollSnapshotRef = React.useRef(result.scrollSnapshot);
  const committedScrollSnapshotRef = React.useRef(result.scrollSnapshot);
  const scrollSnapshotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectedCellKeysRef = React.useRef(result.selectedCellKeys);
  const committedSelectedCellKeysRef = React.useRef(result.selectedCellKeys);
  const selectedCellKeysTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushScrollSnapshot = React.useCallback(() => {
    if (scrollSnapshotTimerRef.current !== null) {
      clearTimeout(scrollSnapshotTimerRef.current);
      scrollSnapshotTimerRef.current = null;
    }
    const pending = pendingScrollSnapshotRef.current;
    const committed = committedScrollSnapshotRef.current;
    if (!pending || (committed && pending.top === committed.top && pending.left === committed.left)) return;
    committedScrollSnapshotRef.current = pending;
    updateViewState({ scrollSnapshot: pending });
  }, [updateViewState]);
  const handleScrollSnapshotChange = React.useCallback((scrollSnapshot: { top: number; left: number }) => {
    pendingScrollSnapshotRef.current = scrollSnapshot;
    if (scrollSnapshotTimerRef.current !== null) return;
    scrollSnapshotTimerRef.current = setTimeout(
      flushScrollSnapshot,
      QUERY_EDITOR_RESULT_SCROLL_SNAPSHOT_PERSIST_DELAY_MS,
    );
  }, [flushScrollSnapshot]);
  const flushSelectedCellKeys = React.useCallback(() => {
    if (selectedCellKeysTimerRef.current !== null) {
      clearTimeout(selectedCellKeysTimerRef.current);
      selectedCellKeysTimerRef.current = null;
    }
    const pending = pendingSelectedCellKeysRef.current;
    const committed = committedSelectedCellKeysRef.current;
    const committedKeys = committed || [];
    if (!pending || (
      pending.length === committedKeys.length
      && pending.every((key, index) => key === committedKeys[index])
    )) return;
    committedSelectedCellKeysRef.current = pending;
    updateViewState({ selectedCellKeys: pending });
  }, [updateViewState]);
  const handleSelectedCellKeysChange = React.useCallback((selectedCellKeys: string[]) => {
    pendingSelectedCellKeysRef.current = selectedCellKeys;
    if (selectedCellKeysTimerRef.current !== null) return;
    selectedCellKeysTimerRef.current = setTimeout(
      flushSelectedCellKeys,
      QUERY_EDITOR_RESULT_CELL_SELECTION_PERSIST_DELAY_MS,
    );
  }, [flushSelectedCellKeys]);

  React.useEffect(() => {
    committedScrollSnapshotRef.current = result.scrollSnapshot;
    if (scrollSnapshotTimerRef.current === null) {
      pendingScrollSnapshotRef.current = result.scrollSnapshot;
    }
  }, [result.scrollSnapshot]);

  React.useEffect(() => {
    committedSelectedCellKeysRef.current = result.selectedCellKeys;
    if (selectedCellKeysTimerRef.current === null) {
      pendingSelectedCellKeysRef.current = result.selectedCellKeys;
    }
  }, [result.selectedCellKeys]);

  React.useEffect(() => () => {
    flushScrollSnapshot();
    flushSelectedCellKeys();
  }, [flushScrollSnapshot, flushSelectedCellKeys]);

  React.useEffect(() => {
    if (!workbenchTabId || typeof window === 'undefined') return undefined;
    const flushPendingViewState = (event: Event) => {
      const tabId = String((event as CustomEvent).detail?.tabId || '').trim();
      if (tabId !== workbenchTabId) return;
      flushScrollSnapshot();
      flushSelectedCellKeys();
    };
    window.addEventListener(
      FLUSH_QUERY_EDITOR_RESULT_VIEW_STATE_EVENT,
      flushPendingViewState,
    );
    return () => window.removeEventListener(
      FLUSH_QUERY_EDITOR_RESULT_VIEW_STATE_EVENT,
      flushPendingViewState,
    );
  }, [flushScrollSnapshot, flushSelectedCellKeys, workbenchTabId]);

  return (
    <DataGrid
      workbenchTabId={workbenchTabId}
      data={result.rows}
      columnNames={resolvedColumns}
      isActive={isActive}
      loading={loading || (!isElasticsearch && result.page?.loading === true)}
      tableName={isElasticsearch ? undefined : resultTableName}
      columnPinScope={isElasticsearch
        ? buildQueryResultColumnPinScope({ sql: result.sql })
        : resultTableName
          ? undefined
          : buildQueryResultColumnPinScope({
            sql: result.exportSql || result.sql,
            sourceStatementIndex: result.sourceStatementIndex,
            statementResultIndex: result.statementResultIndex,
          })}
      exportScope="queryResult"
      resultSql={isElasticsearch ? result.sql : result.exportSql || result.sql}
      resultExportAllSql={isElasticsearch ? undefined : result.page?.exportAllSql}
      dbName={isElasticsearch ? currentDb : result.metadataDbName ?? result.executionDbName ?? currentDb}
      ddlDbName={isElasticsearch ? undefined : result.ddlDbName}
      ddlTableName={isElasticsearch ? undefined : result.ddlTableName}
      connectionId={isElasticsearch ? currentConnectionId : result.executionConnectionId || currentConnectionId}
      connectionParamsOverride={isElasticsearch ? undefined : result.executionConnectionParams}
      queryMaxRows={!isElasticsearch && result.page ? maxRows : undefined}
      initialViewMode={!isElasticsearch && dataPreviewRequest?.resultKey === result.key ? 'table' : undefined}
      initialViewModeRequestId={!isElasticsearch && dataPreviewRequest?.resultKey === result.key ? dataPreviewRequest.requestId : undefined}
      initialViewModeScope={!isElasticsearch && dataPreviewRequest?.resultKey === result.key ? 'local' : undefined}
      pkColumns={isElasticsearch ? [] : result.pkColumns}
      editLocator={isElasticsearch ? undefined : result.editLocator}
      onReload={isElasticsearch ? undefined : (() => result.page
        ? onResultPageChange(result.key, result.page.current, result.page.pageSize)
        : onReloadResult(result.key, result.sql))}
      pagination={!isElasticsearch && result.page ? {
        current: result.page.current,
        pageSize: result.page.pageSize,
        total: result.page.total,
        totalKnown: result.page.totalKnown,
        totalCountLoading: result.page.totalCountLoading,
        totalCountCancelled: result.page.totalCountCancelled,
      } : undefined}
      onPageChange={!isElasticsearch && result.page
        ? ((page, size) => onResultPageChange(result.key, page, size))
        : undefined}
      onSort={isElasticsearch ? undefined : ((field, order) => onResultSort(result.key, field, order))}
      sortInfoExternal={isElasticsearch ? undefined : result.sortInfo || []}
      onRequestTotalCount={!isElasticsearch && result.page && onRequestResultTotalCount
        ? (() => onRequestResultTotalCount(result.key))
        : undefined}
      onCancelTotalCount={!isElasticsearch && result.page && onCancelResultTotalCount
        ? (() => onCancelResultTotalCount(result.key))
        : undefined}
      readOnly={isElasticsearch || result.readOnly}
      toolbarExtraActions={toolbarExtraActions}
      appliedFilterConditions={result.filterConditions}
      onApplyFilter={(filterConditions) => updateViewState({ filterConditions })}
      quickWhereCondition={result.quickWhereCondition}
      onApplyQuickWhereCondition={(quickWhereCondition) => updateViewState({ quickWhereCondition })}
      scrollSnapshot={result.scrollSnapshot}
      onScrollSnapshotChange={handleScrollSnapshotChange}
      sessionState={{
        selectedRowKeys: result.selectedRowKeys,
        onSelectedRowKeysChange: (selectedRowKeys) => updateViewState({ selectedRowKeys }),
        selectedCellKeys: result.selectedCellKeys,
        onSelectedCellKeysChange: handleSelectedCellKeysChange,
        onPendingChangesChange: (hasPendingChanges) => {
          if (hasPendingChanges || result.hasPendingChanges === true) {
            updateViewState({ hasPendingChanges });
          }
        },
      }}
    />
  );
};

export default QueryEditorResultGrid;
