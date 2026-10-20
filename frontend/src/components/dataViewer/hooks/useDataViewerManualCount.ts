import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import { v4 as uuid } from 'uuid';
import { CancelQuery, DBQueryWithCancel } from '../../../../wailsjs/go/app/App';
import { buildRpcConnectionConfig } from '../../../utils/connectionRpcConfig';
import { parseTotalFromCountRow } from '../dataViewerTotals';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ViewerPaginationState } from '../dataViewerTotals';
import type { I18nParams } from '../../../i18n';
import type { useStore } from '../../../store';

type Input = {
  latestConfigRef: MutableRefObject<Parameters<typeof buildRpcConnectionConfig>[0] | null>;
  latestDbNameRef: MutableRefObject<string>;
  latestCountSqlRef: MutableRefObject<string>;
  latestCountKeyRef: MutableRefObject<string>;
  manualCountSeqRef: MutableRefObject<number>;
  manualCountKeyRef: MutableRefObject<string>;
  countKeyRef: MutableRefObject<string>;
  setPagination: Dispatch<SetStateAction<ViewerPaginationState>>;
  addSqlLog: ReturnType<typeof useStore.getState>['addSqlLog'];
  tr: (key: string, params?: I18nParams) => string;
  rocketMQTagTotalCountUnavailable: boolean;
  contextKey: string;
};

export function useDataViewerManualCount(input: Input) {
  const { latestConfigRef, latestDbNameRef, latestCountSqlRef, latestCountKeyRef,
    manualCountSeqRef, manualCountKeyRef, countKeyRef, setPagination, addSqlLog, tr,
    rocketMQTagTotalCountUnavailable, contextKey } = input;
  const activeQuery = useRef<string | null>(null);
  const invalidateManualCount = useCallback(() => {
    manualCountSeqRef.current++;
    const queryID = activeQuery.current;
    activeQuery.current = null;
    manualCountKeyRef.current = '';
    if (queryID) {
      setPagination(prev => ({ ...prev, totalCountLoading: false }));
      void CancelQuery(queryID).catch(() => undefined);
    }
  }, [manualCountSeqRef]);
  useEffect(() => () => invalidateManualCount(), [contextKey, invalidateManualCount]);

  const handleManualTotalCount = useCallback(async (isValid: () => boolean = () => true): Promise<number | null> => {
    if (rocketMQTagTotalCountUnavailable) {
      message.warning(tr('data_grid.toolbar.tag_total_unavailable_tooltip'));
      return null;
    }
    const config = latestConfigRef.current;
    const dbName = latestDbNameRef.current;
    const sql = latestCountSqlRef.current;
    const key = latestCountKeyRef.current;
    if (!config || !sql || !key) {
      message.warning(tr('data_viewer.message.result_not_ready'));
      return null;
    }
    invalidateManualCount();
    const seq = manualCountSeqRef.current;
    const queryID = `viewer-count-${uuid()}`;
    activeQuery.current = queryID;
    manualCountKeyRef.current = key;
    const isCurrent = () => manualCountSeqRef.current === seq && latestCountKeyRef.current === key && isValid();
    const start = Date.now();
    setPagination(prev => ({ ...prev, totalCountLoading: true, totalCountCancelled: false }));
    try {
      const result = await DBQueryWithCancel(buildRpcConnectionConfig(config, { queryTimeout: 120 }), dbName, sql, queryID);
      addSqlLog({ id: queryID, timestamp: Date.now(), sql, dbName,
        status: result.success ? 'success' : 'error', duration: Date.now() - start,
        message: result.success ? '' : result.message });
      if (!isCurrent()) return null;
      if (!result.success) {
        message.error(result.message || tr('data_viewer.message.total_count_failed'));
        return null;
      }
      const total = Array.isArray(result.data) ? parseTotalFromCountRow(result.data[0]) : null;
      if (total === null) {
        message.error(tr('data_viewer.message.total_count_parse_failed'));
        return null;
      }
      countKeyRef.current = key;
      setPagination(prev => ({ ...prev, total, totalKnown: true, totalApprox: false,
        approximateTotal: undefined, totalCountLoading: false, totalCountCancelled: false }));
      return total;
    } catch (error: unknown) {
      if (isCurrent()) message.error(tr('data_viewer.message.total_count_failed_detail', {
        detail: error instanceof Error ? error.message : String(error),
      }));
      return null;
    } finally {
      if (activeQuery.current === queryID) activeQuery.current = null;
      if (isCurrent()) setPagination(prev => ({ ...prev, totalCountLoading: false }));
    }
  }, [addSqlLog, invalidateManualCount, rocketMQTagTotalCountUnavailable, tr]);

  const handleCancelManualTotalCount = useCallback(() => {
    invalidateManualCount();
    setPagination(prev => ({ ...prev, totalCountLoading: false, totalCountCancelled: true }));
  }, [invalidateManualCount, setPagination]);
  return { handleManualTotalCount, handleCancelManualTotalCount, invalidateManualCount };
}
