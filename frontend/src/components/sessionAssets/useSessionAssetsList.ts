import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionAssetView, SessionAssetsApi, SessionAssetsListFilter } from './sessionAssetsApi';

/**
 * 会话列表的加载与筛选状态：筛选变化回到第一页；刷新保留当前条件。
 * 备份更新不扰动排序由后端保证（V-07），这里只透传条件。
 */
export const useSessionAssetsList = (api: SessionAssetsApi, kind: string) => {
  const [items, setItems] = useState<SessionAssetView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SessionAssetsListFilter>({ query: '', backupStatus: '', page: 1, pageSize: 50 });
  const requestSeq = useRef(0);

  const load = useCallback(async (next: SessionAssetsListFilter) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const result = await api.listAssets(kind, next);
      if (seq !== requestSeq.current) return;
      setItems(result?.items ?? []);
      setTotal(result?.total ?? 0);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [api, kind]);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const updateFilter = useCallback((patch: Partial<SessionAssetsListFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  }, []);

  return { items, total, loading, filter, updateFilter, reload: () => load(filter) };
};
