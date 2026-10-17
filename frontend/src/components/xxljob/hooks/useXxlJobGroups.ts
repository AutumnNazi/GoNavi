import { useCallback, useState } from 'react';
import { xxlJobRpc, type XxlJobRpcResult } from '../xxljobRpc';
import {
  DEFAULT_PAGE_SIZE,
  XXL_JOB_MAX_PAGE_SIZE,
  type XxlJobGroup,
  type XxlJobInfo,
  type XxlJobPage,
} from '../xxljobModel';
import { useXxlJobConnection, useXxlJobPage, useXxlJobReadOnly } from './useXxlJobPage';

type QueryResult<T> = { success: boolean; message?: string; data?: T };

// 执行器面板：分页 + appname / 名称筛选。
export const useXxlJobGroups = (connectionId: string, isActive: boolean) => {
  const { connection, rpcConfig } = useXxlJobConnection(connectionId);
  const readOnly = useXxlJobReadOnly(connection);
  const [appName, setAppName] = useState('');
  const [title, setTitle] = useState('');
  const [applied, setApplied] = useState({ appName: '', title: '' });

  const fetchGroups = useCallback(
    (config: unknown, params: Record<string, unknown>) =>
      xxlJobRpc.listJobGroups(config as never, params as never) as Promise<QueryResult<XxlJobPage<XxlJobGroup>>>,
    [],
  );
  const buildParams = useCallback(
    (page: number, size: number) => ({
      page,
      size,
      appName: applied.appName,
      title: applied.title,
    }),
    [applied],
  );

  const page = useXxlJobPage<XxlJobGroup>(isActive, fetchGroups, rpcConfig, buildParams);

  const applyFilters = useCallback(() => {
    page.setPage(1);
    setApplied({ appName: appName.trim(), title: title.trim() });
  }, [appName, title, page]);

  const resetFilters = useCallback(() => {
    setAppName('');
    setTitle('');
    setApplied({ appName: '', title: '' });
    page.setPage(1);
  }, [page]);

  // 任务面板的执行器下拉需要全部执行器，因此单独提供一次不分页的拉取。
  const [allGroups, setAllGroups] = useState<XxlJobGroup[]>([]);
  const loadAllGroups = useCallback(async () => {
    if (!rpcConfig) return;
    const groups: XxlJobGroup[] = [];
    // 调度中心单页上限 200；超过一页时翻页拉全，避免下拉静默缺项。
    for (let page = 1; ; page += 1) {
      const result = (await xxlJobRpc.listJobGroups(rpcConfig as never, {
        page,
        size: MAX_GROUP_PAGE_SIZE,
        appName: '',
        title: '',
      } as never)) as QueryResult<XxlJobPage<XxlJobGroup>>;
      const rows = result?.success && Array.isArray(result.data?.rows) ? result.data.rows : [];
      groups.push(...rows);
      const total = Number(result?.data?.total ?? 0);
      if (rows.length < MAX_GROUP_PAGE_SIZE || groups.length >= total || page >= MAX_GROUP_PAGES) {
        break;
      }
    }
    setAllGroups(groups);
  }, [rpcConfig]);

  return {
    ...page,
    connection,
    rpcConfig,
    readOnly,
    appName,
    title,
    setAppName,
    setTitle,
    applyFilters,
    resetFilters,
    allGroups,
    loadAllGroups,
  };
};

// 任务面板依赖执行器列表做下拉联动，单独导出以便复用。
export type XxlJobGroupOption = { label: string; value: number };

// 拉全执行器的翻页上限：防御调度中心 total 异常导致的死循环。
const MAX_GROUP_PAGE_SIZE = XXL_JOB_MAX_PAGE_SIZE;
const MAX_GROUP_PAGES = 50;

export const toGroupOptions = (groups: Array<XxlJobGroup | XxlJobInfo>): XxlJobGroupOption[] =>
  groups.map((group) => ({
    label: (group as XxlJobGroup).title || (group as XxlJobGroup).appName || String((group as XxlJobGroup).id),
    value: Number((group as XxlJobGroup).id),
  }));
