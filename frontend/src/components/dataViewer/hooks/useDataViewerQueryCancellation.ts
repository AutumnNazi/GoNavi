import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import { v4 as uuid } from 'uuid';
import { CancelQuery, DBQueryApplicationWithCancel } from '../../../../wailsjs/go/app/App';
import type { UseDataViewerFetchDataInput } from './useDataViewerFetchData';

type Input = Pick<UseDataViewerFetchDataInput,
  'fetchSeqRef' | 'setLoading' | 'invalidateManualCount' | 'addSqlLog' | 'viewerLoadContextKey'>;

export function useDataViewerQueryCancellation({
  fetchSeqRef, setLoading, invalidateManualCount, addSqlLog, viewerLoadContextKey,
}: Input) {
  const activeQueries = useRef(new Set<string>());
  const cancelQueries = useCallback(() => {
    for (const id of activeQueries.current) {
      void CancelQuery(id).then(result => {
        if (!result.success && result.message) message.warning(result.message);
      }).catch(error => message.warning(String(error)));
    }
    activeQueries.current.clear();
  }, []);
  const cancelFetch = useCallback(() => {
    fetchSeqRef.current++;
    cancelQueries();
    invalidateManualCount();
    setLoading(false);
  }, [fetchSeqRef, cancelQueries, invalidateManualCount, setLoading]);
  useEffect(() => () => {
    fetchSeqRef.current++;
    cancelQueries();
  }, [viewerLoadContextKey, fetchSeqRef, cancelQueries]);

  const executeQuery = useCallback(async (
    seq: number, config: Parameters<typeof DBQueryApplicationWithCancel>[0],
    dbName: string, sql: string, attemptLabel: string,
  ) => {
    const assertCurrent = () => {
      if (fetchSeqRef.current !== seq) throw new Error('Table refresh cancelled');
    };
    assertCurrent();
    const id = `table-refresh-${uuid()}`;
    activeQueries.current.add(id);
    const start = Date.now();
    const result = await DBQueryApplicationWithCancel(config, dbName, sql, id)
      .catch((error: unknown) => ({
        success: false, message: error instanceof Error ? error.message : String(error),
        data: [], fields: [],
      })).finally(() => activeQueries.current.delete(id));
    assertCurrent();
    addSqlLog({
      id: `log-${id}`, timestamp: Date.now(), sql,
      status: result.success ? 'success' : 'error', duration: Date.now() - start,
      message: result.success ? '' : `${attemptLabel}: ${result.message}`,
      affectedRows: Array.isArray(result.data) ? result.data.length : undefined, dbName,
    });
    return result;
  }, [fetchSeqRef, addSqlLog]);
  return { cancelFetch, cancelQueries, executeQuery };
}
