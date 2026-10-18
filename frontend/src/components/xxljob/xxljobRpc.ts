import {
  XxlJobDeleteJobGroups,
  XxlJobDeleteJobs,
  XxlJobListJobGroups,
  XxlJobListJobs,
  XxlJobListLogs,
  XxlJobLogDetail,
  XxlJobLogKill,
  XxlJobNextTriggerTimes,
  XxlJobSaveGlueSource,
  XxlJobSaveJob,
  XxlJobSaveJobGroup,
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

// 任务表单载荷：字段名与官方后台 POJO 一致（见 internal/app XxlJobJobMutation）。
export type XxlJobJobMutationPayload = {
  id: number;
  jobGroup: number;
  name: string;
  author: string;
  alarmEmail: string;
  scheduleType: string;
  scheduleConf: string;
  misfireStrategy: string;
  executorRouteStrategy: string;
  executorHandler: string;
  executorParam: string;
  executorBlockStrategy: string;
  executorTimeout: number;
  executorFailRetryCount: number;
  glueType: string;
  glueSource: string;
  glueRemark: string;
  childJobId: string;
  triggerStatus: number;
};

// 执行器表单载荷（见 internal/app XxlJobGroupMutation）。
export type XxlJobGroupMutationPayload = {
  id: number;
  appName: string;
  title: string;
  addressType: number;
  addressList: string;
};

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
  saveJob: (config: connection.ConnectionConfig, job: XxlJobJobMutationPayload) =>
    XxlJobSaveJob(config, job as never) as XxlJobRpcResult<{ id?: number }>,
  deleteJobs: (config: connection.ConnectionConfig, jobIds: number[]) =>
    XxlJobDeleteJobs(config, jobIds) as XxlJobRpcResult<unknown>,
  saveJobGroup: (config: connection.ConnectionConfig, group: XxlJobGroupMutationPayload) =>
    XxlJobSaveJobGroup(config, group as never) as XxlJobRpcResult<{ id?: number }>,
  deleteJobGroups: (config: connection.ConnectionConfig, groupIds: number[]) =>
    XxlJobDeleteJobGroups(config, groupIds) as XxlJobRpcResult<unknown>,
  saveGlueSource: (config: connection.ConnectionConfig, jobId: number, glueSource: string, glueRemark: string) =>
    XxlJobSaveGlueSource(config, jobId, glueSource, glueRemark) as XxlJobRpcResult<unknown>,
};
