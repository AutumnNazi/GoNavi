import { useCallback, useState } from 'react';
import { xxlJobRpc, type XxlJobRpcResult } from '../xxljobRpc';
import { buildFilterTime, type XxlJobLog, type XxlJobLogDetail, type XxlJobPage } from '../xxljobModel';
import { useXxlJobConnection, useXxlJobPage, useXxlJobReadOnly } from './useXxlJobPage';

type QueryResult<T> = { success: boolean; message?: string; data?: T };

// 日志面板：执行器 / 任务 / 状态 / 时间范围筛选，详情抽屉按 fromLineNum 续读。
export const useXxlJobLogs = (connectionId: string, isActive: boolean) => {
  const { connection, rpcConfig } = useXxlJobConnection(connectionId);
  const readOnly = useXxlJobReadOnly(connection);
  const [jobGroup, setJobGroup] = useState<number | undefined>(undefined);
  const [jobId, setJobId] = useState<number | undefined>(undefined);
  const [logStatus, setLogStatus] = useState<number>(-1);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchLogs = useCallback(
    (config: unknown, params: Record<string, unknown>) =>
      xxlJobRpc.listLogs(config as never, params) as Promise<QueryResult<XxlJobPage<XxlJobLog>>>,
    [],
  );
  const buildParams = useCallback(
    (page: number, size: number) => ({
      page,
      size,
      jobGroup: jobGroup ?? 0,
      jobId: jobId ?? 0,
      logStatus,
      filterTime: buildFilterTime(range),
    }),
    [jobGroup, jobId, logStatus, range],
  );

  const page = useXxlJobPage<XxlJobLog>(isActive, fetchLogs, rpcConfig, buildParams);

  const changeFilter = useCallback((patch: {
    jobGroup?: number;
    jobId?: number;
    logStatus?: number;
    range?: [string, string] | null;
  }) => {
    page.setPage(1);
    if (patch.jobGroup !== undefined) setJobGroup(patch.jobGroup);
    if (patch.jobId !== undefined) setJobId(patch.jobId);
    if (patch.logStatus !== undefined) setLogStatus(patch.logStatus);
    if (patch.range !== undefined) setRange(patch.range);
  }, [page]);

  const logKill = useCallback(async (logId: number) => {
    if (!rpcConfig) return null;
    setBusy(true);
    try {
      return await xxlJobRpc.logKill(rpcConfig as never, logId);
    } finally {
      setBusy(false);
      page.reload();
    }
  }, [rpcConfig, page]);

  // 详情：fromLineNum 传入上一次读到的 toLineNum，实现增量续读。
  const fetchLogDetail = useCallback(async (logId: number, fromLineNum: number) => {
    if (!rpcConfig) return null;
    return xxlJobRpc.logDetail(rpcConfig as never, logId, fromLineNum) as Promise<QueryResult<XxlJobLogDetail>>;
  }, [rpcConfig]);

  return {
    ...page,
    connection,
    rpcConfig,
    readOnly,
    busy,
    jobGroup,
    jobId,
    logStatus,
    range,
    changeFilter,
    logKill,
    fetchLogDetail,
  };
};
