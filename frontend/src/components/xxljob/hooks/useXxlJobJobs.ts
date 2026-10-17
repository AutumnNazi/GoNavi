import { useCallback, useState } from 'react';
import { xxlJobRpc, type XxlJobRpcResult } from '../xxljobRpc';
import type { XxlJobInfo, XxlJobPage } from '../xxljobModel';
import { useXxlJobConnection, useXxlJobPage, useXxlJobReadOnly } from './useXxlJobPage';

type QueryResult<T> = { success: boolean; message?: string; data?: T };

// 任务面板：执行器联动下拉 + 状态筛选 + 启停 / 执行一次 / 下次触发时间。
export const useXxlJobJobs = (connectionId: string, isActive: boolean) => {
  const { connection, rpcConfig } = useXxlJobConnection(connectionId);
  const readOnly = useXxlJobReadOnly(connection);
  const [jobGroup, setJobGroup] = useState<number | undefined>(undefined);
  const [triggerStatus, setTriggerStatus] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const fetchJobs = useCallback(
    (config: unknown, params: Record<string, unknown>) =>
      xxlJobRpc.listJobs(config as never, params) as Promise<QueryResult<XxlJobPage<XxlJobInfo>>>,
    [],
  );
  const buildParams = useCallback(
    (page: number, size: number) => ({
      page,
      size,
      jobGroup: jobGroup ?? 0,
      triggerStatus: triggerStatus ?? -1,
      name: '',
      executorHandler: '',
      author: '',
    }),
    [jobGroup, triggerStatus],
  );

  const page = useXxlJobPage<XxlJobInfo>(isActive, fetchJobs, rpcConfig, buildParams);

  // 调度中心的过滤参数不接受「不传」，未选择时用 0 / -1 表达全量。
  const changeJobGroup = useCallback((value?: number) => {
    page.setPage(1);
    setJobGroup(value);
  }, [page]);

  const changeTriggerStatus = useCallback((value?: number) => {
    page.setPage(1);
    setTriggerStatus(value);
  }, [page]);

  const withBusy = useCallback(async (run: () => Promise<QueryResult<unknown>>) => {
    setBusy(true);
    try {
      return await run();
    } finally {
      setBusy(false);
      page.reload();
    }
  }, [page]);

  const triggerJob = useCallback(async (jobId: number, executorParam: string) => {
    if (!rpcConfig) return null;
    return withBusy(() => xxlJobRpc.triggerJob(rpcConfig as never, jobId, executorParam));
  }, [rpcConfig, withBusy]);

  const startJobs = useCallback(async (jobIds: number[]) => {
    if (!rpcConfig || jobIds.length === 0) return null;
    return withBusy(() => xxlJobRpc.startJobs(rpcConfig as never, jobIds));
  }, [rpcConfig, withBusy]);

  const stopJobs = useCallback(async (jobIds: number[]) => {
    if (!rpcConfig || jobIds.length === 0) return null;
    return withBusy(() => xxlJobRpc.stopJobs(rpcConfig as never, jobIds));
  }, [rpcConfig, withBusy]);

  const nextTriggerTimes = useCallback(async (scheduleType: string, scheduleConf: string) => {
    if (!rpcConfig) return [] as string[];
    const result = await xxlJobRpc.nextTriggerTimes(rpcConfig as never, scheduleType, scheduleConf);
    if (!result?.success) return [] as string[];
    return Array.isArray(result.data) ? (result.data as string[]) : [];
  }, [rpcConfig]);

  return {
    ...page,
    connection,
    rpcConfig,
    readOnly,
    busy,
    jobGroup,
    triggerStatus,
    changeJobGroup,
    changeTriggerStatus,
    triggerJob,
    startJobs,
    stopJobs,
    nextTriggerTimes,
  };
};
