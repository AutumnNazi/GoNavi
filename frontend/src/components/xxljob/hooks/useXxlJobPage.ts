import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store';
import { buildRpcConnectionConfig } from '../../../utils/connectionRpcConfig';
import type { SavedConnection } from '../../../types';
import {
  DEFAULT_PAGE_SIZE,
  XxlJobGroup,
  XxlJobPage,
} from '../xxljobModel';

type QueryResult<T> = { success: boolean; message?: string; data?: T };

// 解析标签页对应的连接，并产出可直接交给 Wails 绑定的 RPC 配置。
// 连接在标签页存活期间可能被编辑，因此每次渲染都重新读取，避免持有过期快照。
export const useXxlJobConnection = (connectionId: string) => {
  const connection = useStore((state) =>
    state.connections.find((item: SavedConnection) => item.id === connectionId),
  );
  const rpcConfig = useMemo(
    () => (connection ? buildRpcConnectionConfig(connection.config as never) : null),
    [connection],
  );
  return { connection, rpcConfig };
};

// 只读判定：只读开关或生产保护命中时禁用启停、执行一次与终止。
export const useXxlJobReadOnly = (connection?: SavedConnection | null): boolean => {
  if (!connection) return true;
  const config = connection.config;
  if (config?.readOnly) return true;
  const protection = config?.protection;
  return Boolean(
    protection?.restrictScriptExecution
    || protection?.restrictDataEdit
    || protection?.restrictStructureEdit
    || protection?.restrictDataImport,
  );
};

type PageState<T> = {
  rows: T[];
  total: number;
  loading: boolean;
  error: string;
  page: number;
  size: number;
  reload: () => void;
  setPage: (page: number) => void;
  setSize: (size: number) => void;
};

type ListParams = Record<string, unknown>;

// 三种列表共用的分页加载逻辑：一次请求一页。
// 失败时保留错误文案而不是静默空列表，以便区分「没有数据」与「读不到数据」。
export const useXxlJobPage = <T,>(
  isActive: boolean,
  fetcher: (config: unknown, params: ListParams) => Promise<QueryResult<XxlJobPage<T>>>,
  rpcConfig: unknown,
  buildParams: (page: number, size: number) => ListParams,
): PageState<T> => {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!isActive || !rpcConfig) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetcher(rpcConfig, buildParams(page, size))
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) {
          setError(String(result?.message ?? ''));
          setRows([]);
          setTotal(0);
          return;
        }
        const data = result.data;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setTotal(Number(data?.total ?? 0));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isActive, rpcConfig, fetcher, buildParams, page, size, reloadToken]);

  return { rows, total, loading, error, page, size, reload, setPage, setSize };
};
