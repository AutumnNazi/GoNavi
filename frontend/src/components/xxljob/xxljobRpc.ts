import {
  XxlJobListJobGroups,
  XxlJobListJobs,
  XxlJobListLogs,
  XxlJobLogDetail,
  XxlJobLogKill,
  XxlJobNextTriggerTimes,
  XxlJobStartJobs,
  XxlJobStopJobs,
  XxlJobTriggerJob,
} from '../../../wailsjs/go/app/App';
import type { connection } from '../../../wailsjs/go/models';

// Wails 绑定返回的是 connection.QueryResult（data 为 any）。
// 这里把 data 收敛成调用方声明的类型，避免 any 扩散到 hooks 与面板里。
export type XxlJobRpcResult<T> = Promise<{
  success: boolean;
  message?: string;
  data?: T;
}>;

export const xxlJobRpc = {
  listJobGroups: (config: connection.ConnectionConfig, query: object) =>
    XxlJobListJobGroups(config, query as never) as XxlJobRpcResult<unknown>,
  listJobs: (config: connection.ConnectionConfig, query: object) =>
    XxlJobListJobs(config, query as never) as XxlJobRpcResult<unknown>,
  listLogs: (config: connection.ConnectionConfig, query: object) =>
    XxlJobListLogs(config, query as never) as XxlJobRpcResult<unknown>,
  nextTriggerTimes: (config: connection.ConnectionConfig, scheduleType: string, scheduleConf: string) =>
    XxlJobNextTriggerTimes(config, scheduleType, scheduleConf) as XxlJobRpcResult<string[]>,
  triggerJob: (config: connection.ConnectionConfig, jobId: number, executorParam: string) =>
    XxlJobTriggerJob(config, jobId, executorParam) as XxlJobRpcResult<{ detail?: string }>,
  startJobs: (config: connection.ConnectionConfig, jobIds: number[]) =>
    XxlJobStartJobs(config, jobIds) as XxlJobRpcResult<unknown>,
  stopJobs: (config: connection.ConnectionConfig, jobIds: number[]) =>
    XxlJobStopJobs(config, jobIds) as XxlJobRpcResult<unknown>,
  logDetail: (config: connection.ConnectionConfig, logId: number, fromLineNum: number) =>
    XxlJobLogDetail(config, logId, fromLineNum) as XxlJobRpcResult<unknown>,
  logKill: (config: connection.ConnectionConfig, logId: number) =>
    XxlJobLogKill(config, logId) as XxlJobRpcResult<unknown>,
};
