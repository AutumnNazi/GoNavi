import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  getViewerFilterSnapshot,
  shouldDeferInitialDataViewerFetch,
  type ViewerScrollSnapshot,
  type ViewerFilterSnapshot,
  setViewerFilterSnapshot,
  normalizeViewerFilterConditions,
  VIEWER_SCROLL_SNAPSHOT_PERSIST_DELAY_MS,
} from '../dataViewerFilterSnapshots';
import type { EditRowLocator } from '../../../utils/rowLocator';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { type I18nParams, t as translate, resolveLanguage } from '../../../i18n';
import { type ViewerPaginationState } from '../dataViewerTotals';
import type { FilterCondition } from '../../../utils/sql';
import { getDataSourceCapabilities } from '../../../utils/dataSourceCapabilities';
import { isRocketMQTagFilteredConnection } from '../../../utils/rocketmqTagFilter';
import { normalizeQuickWhereCondition } from '../../../utils/dataGridWhereFilter';
import { useDataViewerManualCount } from './useDataViewerManualCount';
import { confirmRabbitMQPreview } from '../../../utils/rabbitmqPreview';
import type { DataViewerProps } from '../../DataViewer';

export interface UseDataViewerStateInput {
  tab: DataViewerProps['tab'];
}

export const useDataViewerState = ({ tab }: UseDataViewerStateInput) => {
  const initialViewerSnapshot = useMemo(() => getViewerFilterSnapshot(tab.id), [tab.id]);
  const viewerLoadContextKey = `${tab.id}|${tab.connectionId}|${tab.dbName || ''}|${tab.tableName || ''}|${tab.objectType || 'table'}`;
  const deferInitialDataFetch = shouldDeferInitialDataViewerFetch(tab.initialViewMode);
  const [data, setData] = useState<any[]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [editLocator, setEditLocator] = useState<EditRowLocator | undefined>(undefined);
  const [loadingState, setLoading] = useState(() => !deferInitialDataFetch);
  const loadingContextKeyRef = useRef(viewerLoadContextKey);
  const loading = loadingContextKeyRef.current === viewerLoadContextKey
    ? loadingState
    : !deferInitialDataFetch;
  const connections = useStore(state => state.connections);
  const addSqlLog = useStore(state => state.addSqlLog);
  const appearance = useStore(state => state.appearance);
  const i18n = useOptionalI18n();
  const languagePreference = useStore(state => state.languagePreference);
  const tr = useCallback((key: string, params?: I18nParams) => {
    if (i18n?.t) {
      return i18n.t(key, params);
    }
    return translate(key, params, resolveLanguage(languagePreference));
  }, [i18n, languagePreference]);

  const fetchSeqRef = useRef(0);
  const countSeqRef = useRef(0);
  const countKeyRef = useRef<string>('');
  const duckdbApproxSeqRef = useRef(0);
  const duckdbApproxKeyRef = useRef<string>('');
  const oracleApproxSeqRef = useRef(0);
  const oracleApproxKeyRef = useRef<string>('');
  const autoCountKeyRef = useRef<string>('');
  const manualCountSeqRef = useRef(0);
  const manualCountKeyRef = useRef<string>('');
  const pkSeqRef = useRef(0);
  const pkKeyRef = useRef<string>('');
  const latestConfigRef = useRef<any>(null);
  const latestDbTypeRef = useRef<string>('');
  const latestDbNameRef = useRef<string>('');
  const latestCountSqlRef = useRef<string>('');
  const latestCountKeyRef = useRef<string>('');
  const scrollSnapshotRef = useRef<ViewerScrollSnapshot>({
    top: initialViewerSnapshot.scrollTop,
    left: initialViewerSnapshot.scrollLeft,
  });
  const pendingScrollSnapshotPersistRef = useRef<ViewerScrollSnapshot | null>(null);
  const scrollSnapshotPersistTimerRef = useRef<number | null>(null);
  const initialLoadRef = useRef(false);
  const skipNextAutoFetchRef = useRef(false);
  const deferredInitialFetchRef = useRef(shouldDeferInitialDataViewerFetch(tab.initialViewMode));
  const rabbitMQPreviewConfirmedRef = useRef(false);
  const rabbitMQPreviewConfirmationRef = useRef<Promise<boolean> | null>(null);

  const [pagination, setPagination] = useState<ViewerPaginationState>({
      current: initialViewerSnapshot.currentPage,
      pageSize: initialViewerSnapshot.pageSize,
      total: 0,
      totalKnown: false,
      totalApprox: false,
      totalCountLoading: false,
      totalCountCancelled: false,
  });

  const [sortInfo, setSortInfo] = useState<Array<{ columnKey: string, order: string, enabled?: boolean }>>(initialViewerSnapshot.sortInfo);

  const [showFilter, setShowFilter] = useState<boolean>(initialViewerSnapshot.showFilter);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>(initialViewerSnapshot.conditions);
  const [quickWhereCondition, setQuickWhereCondition] = useState<string>(initialViewerSnapshot.quickWhereCondition);
  const duckdbSafeSelectCacheRef = useRef<Record<string, string>>({});
  const currentConnConfig = connections.find(c => c.id === tab.connectionId)?.config;
  const currentConnCaps = getDataSourceCapabilities(currentConnConfig);
  // Ordinary views can reject physical ROWID (for example Oracle join views), so
  // browse them without attempting the editable-table locator optimization.
  const forceReadOnly = currentConnCaps.forceReadOnlyQueryResult || tab.objectType === 'view';
  const preferManualTotalCount = currentConnCaps.preferManualTotalCount;
  const supportsApproximateTableCount = currentConnCaps.supportsApproximateTableCount;
  const supportsApproximateTotalPages = currentConnCaps.supportsApproximateTotalPages;
  const rocketMQTagTotalCountUnavailable = isRocketMQTagFilteredConnection(currentConnConfig);
  const totalCountUnavailableLabel = rocketMQTagTotalCountUnavailable
    ? tr('data_grid.toolbar.tag_total_unavailable')
    : undefined;
  const totalCountUnavailableReason = rocketMQTagTotalCountUnavailable
    ? tr('data_grid.toolbar.tag_total_unavailable_tooltip')
    : undefined;
  const persistViewerSnapshot = useCallback((tabId: string, overrides?: Partial<ViewerFilterSnapshot>) => {
    const normalizedTabId = String(tabId || '').trim();
    if (!normalizedTabId) return;
    setViewerFilterSnapshot(normalizedTabId, {
      showFilter,
      conditions: normalizeViewerFilterConditions(filterConditions),
      quickWhereCondition: normalizeQuickWhereCondition(quickWhereCondition),
      currentPage: pagination.current,
      pageSize: pagination.pageSize,
      sortInfo,
      scrollTop: scrollSnapshotRef.current.top,
      scrollLeft: scrollSnapshotRef.current.left,
      ...overrides,
    });
  }, [showFilter, filterConditions, quickWhereCondition, pagination.current, pagination.pageSize, sortInfo]);

  useEffect(() => {
    const snapshot = getViewerFilterSnapshot(tab.id);
    setShowFilter(snapshot.showFilter);
    setFilterConditions(snapshot.conditions);
    setQuickWhereCondition(snapshot.quickWhereCondition);
    setSortInfo(snapshot.sortInfo);
    scrollSnapshotRef.current = { top: snapshot.scrollTop, left: snapshot.scrollLeft };
    initialLoadRef.current = false;
  }, [tab.id]);

  useEffect(() => {
    persistViewerSnapshot(tab.id);
  }, [persistViewerSnapshot]);

  useEffect(() => {
    return () => {
      if (scrollSnapshotPersistTimerRef.current !== null) {
        window.clearTimeout(scrollSnapshotPersistTimerRef.current);
        scrollSnapshotPersistTimerRef.current = null;
      }
      const pendingScrollSnapshot = pendingScrollSnapshotPersistRef.current;
      pendingScrollSnapshotPersistRef.current = null;
      persistViewerSnapshot(tab.id, pendingScrollSnapshot ? {
        scrollTop: pendingScrollSnapshot.top,
        scrollLeft: pendingScrollSnapshot.left,
      } : undefined);
    };
  }, [tab.id, persistViewerSnapshot]);

  useEffect(() => {
    const snapshot = getViewerFilterSnapshot(tab.id);
    setPkColumns([]);
    setEditLocator(undefined);
    pkKeyRef.current = '';
    countKeyRef.current = '';
    duckdbApproxKeyRef.current = '';
    oracleApproxKeyRef.current = '';
    autoCountKeyRef.current = '';
    manualCountKeyRef.current = '';
    duckdbSafeSelectCacheRef.current = {};
    latestConfigRef.current = null;
    latestDbTypeRef.current = '';
    latestDbNameRef.current = '';
    latestCountSqlRef.current = '';
    latestCountKeyRef.current = '';
    scrollSnapshotRef.current = { top: snapshot.scrollTop, left: snapshot.scrollLeft };
    initialLoadRef.current = false;
    rabbitMQPreviewConfirmedRef.current = false;
    rabbitMQPreviewConfirmationRef.current = null;
    deferredInitialFetchRef.current = shouldDeferInitialDataViewerFetch(tab.initialViewMode);
    skipNextAutoFetchRef.current = true;
    setPagination(prev => ({
      ...prev,
      current: snapshot.currentPage,
      pageSize: snapshot.pageSize,
      total: 0,
      totalKnown: false,
      totalApprox: false,
      approximateTotal: undefined,
      totalCountLoading: false,
      totalCountCancelled: false,
    }));
  }, [tab.id, tab.connectionId, tab.dbName, tab.tableName, tab.objectType]);

  const handleTableScrollSnapshotChange = useCallback((snapshot: ViewerScrollSnapshot) => {
    scrollSnapshotRef.current = snapshot;
    pendingScrollSnapshotPersistRef.current = snapshot;
    if (scrollSnapshotPersistTimerRef.current !== null) {
      window.clearTimeout(scrollSnapshotPersistTimerRef.current);
    }
    scrollSnapshotPersistTimerRef.current = window.setTimeout(() => {
      scrollSnapshotPersistTimerRef.current = null;
      const pendingScrollSnapshot = pendingScrollSnapshotPersistRef.current;
      pendingScrollSnapshotPersistRef.current = null;
      if (!pendingScrollSnapshot) return;
      persistViewerSnapshot(tab.id, {
        scrollTop: pendingScrollSnapshot.top,
        scrollLeft: pendingScrollSnapshot.left,
      });
    }, VIEWER_SCROLL_SNAPSHOT_PERSIST_DELAY_MS);
  }, [tab.id, persistViewerSnapshot]);

  const { handleManualTotalCount, handleCancelManualTotalCount, invalidateManualCount } = useDataViewerManualCount({
    latestConfigRef, latestDbNameRef, latestCountSqlRef, latestCountKeyRef,
    manualCountSeqRef, manualCountKeyRef, countKeyRef, setPagination, addSqlLog, tr,
    rocketMQTagTotalCountUnavailable,
    contextKey: `${viewerLoadContextKey}|${JSON.stringify(filterConditions)}|${quickWhereCondition}`,
  });

  const ensureRabbitMQPreviewConfirmed = useCallback(async (queue: string): Promise<boolean> => {
    if (rabbitMQPreviewConfirmedRef.current) return true;

    const pendingConfirmation = rabbitMQPreviewConfirmationRef.current || (() => {
      const nextConfirmation = confirmRabbitMQPreview({ queue, translate: tr });
      rabbitMQPreviewConfirmationRef.current = nextConfirmation;
      return nextConfirmation;
    })();
    const approved = await pendingConfirmation;
    if (rabbitMQPreviewConfirmationRef.current === pendingConfirmation) {
      rabbitMQPreviewConfirmationRef.current = null;
    }
    if (approved) rabbitMQPreviewConfirmedRef.current = true;
    return approved;
  }, [tr]);
  return {
    viewerLoadContextKey, data, setData, columnNames, setColumnNames, pkColumns, setPkColumns,
    editLocator, setEditLocator, setLoading, loadingContextKeyRef, loading, connections, addSqlLog,
    tr, fetchSeqRef, countSeqRef, countKeyRef, duckdbApproxSeqRef, duckdbApproxKeyRef,
    oracleApproxSeqRef, oracleApproxKeyRef, autoCountKeyRef, manualCountSeqRef, manualCountKeyRef,
    pkSeqRef, pkKeyRef, latestConfigRef, latestDbTypeRef, latestDbNameRef, latestCountSqlRef,
    latestCountKeyRef, scrollSnapshotRef, initialLoadRef, skipNextAutoFetchRef,
    deferredInitialFetchRef, rabbitMQPreviewConfirmedRef, pagination, setPagination, sortInfo,
    setSortInfo, showFilter, setShowFilter, filterConditions, setFilterConditions,
    quickWhereCondition, setQuickWhereCondition, duckdbSafeSelectCacheRef, currentConnConfig,
    forceReadOnly, preferManualTotalCount, supportsApproximateTableCount,
    supportsApproximateTotalPages, rocketMQTagTotalCountUnavailable, totalCountUnavailableLabel,
    totalCountUnavailableReason, handleTableScrollSnapshotChange, handleManualTotalCount,
    handleCancelManualTotalCount, invalidateManualCount, ensureRabbitMQPreviewConfirmed,
  };
};

export type DataViewerStateApi = ReturnType<typeof useDataViewerState>;
