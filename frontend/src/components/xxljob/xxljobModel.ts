import type { XxlJobPanel } from '../../typeDefs/workbenchTypes';

/** 调度中心返回的执行器。字段名与 XXL-JOB 官方实体对齐，3.5.0 的 name 已并入 title。 */
export type XxlJobGroup = {
  id: number;
  appName: string;
  title: string;
  addressType: number;
  addressList: string;
  updateTime?: string;
  registryList?: Array<{ registryGroup?: string; registryKey?: string; updateTime?: string }>;
};

/** 调度中心返回的任务定义。 */
export type XxlJobInfo = {
  id: number;
  jobGroup: number;
  name: string;
  author?: string;
  alarmEmail?: string;
  scheduleType?: string;
  scheduleConf?: string;
  misfireStrategy?: string;
  executorRouteStrategy?: string;
  executorHandler?: string;
  executorParam?: string;
  executorBlockStrategy?: string;
  executorTimeout?: number;
  executorFailRetryCount?: number;
  glueType?: string;
  glueSource?: string;
  glueRemark?: string;
  childJobId?: string;
  triggerStatus: number;
  triggerLastTime?: string;
  triggerNextTime?: string;
};

/** 一次执行记录。handleCode 为 0 且 triggerCode 为 200 表示仍在运行。 */
export type XxlJobLog = {
  id: number;
  jobGroup: number;
  jobId: number;
  executorAddress?: string;
  executorHandler?: string;
  executorParam?: string;
  triggerTime?: string;
  triggerCode: number;
  triggerMsg?: string;
  handleTime?: string;
  handleCode: number;
  handleMsg?: string;
};

/** 执行器转发的滚动日志切片。 */
export type XxlJobLogDetail = {
  fromLineNum: number;
  toLineNum: number;
  logContent: string;
  isEnd: boolean;
};

/** 后端统一分页信封。 */
export type XxlJobPage<T> = {
  page: number;
  size: number;
  total: number;
  rows: T[];
};

/** 任务触发状态，与 XXL-JOB 的 triggerStatus 一致。 */
export const TRIGGER_STATUS_STOPPED = 0;
export const TRIGGER_STATUS_RUNNING = 1;

/** 日志状态筛选码。 */
export const LOG_STATUS_ALL = -1;
export const LOG_STATUS_SUCCESS = 1;
export const LOG_STATUS_FAILED = 2;
export const LOG_STATUS_RUNNING = 3;

export const DEFAULT_PAGE_SIZE = 20;

/** 调度中心 pageList 单页条数上限（maxPageSize）。 */
export const XXL_JOB_MAX_PAGE_SIZE = 200;

/** 调度中心对执行状态码的固定取值。 */
export const XXL_JOB_CODE_OK = 200;

/** 执行超时的固定状态码（官方 joblog_handleCode_502）。 */
export const XXL_JOB_CODE_TIMEOUT = 502;

/**
 * 判断一条执行记录是否仍在运行。调度中心在执行器回报前把 handleCode 留为 0，
 * 这也是「终止」唯一可用的状态。
 */
export const isXxlJobLogRunning = (log: Pick<XxlJobLog, 'triggerCode' | 'handleCode'>): boolean =>
  log.triggerCode === XXL_JOB_CODE_OK && log.handleCode === 0;

/** 把调度中心的时间串归一为可展示文本；空值统一显示为破折号。 */
export const formatXxlJobTime = (value?: string): string => {
  const text = String(value ?? '').trim();
  return text || '—';
};

/** 任意文本的空值兜底（地址等非时间字段与时间共用破折号语义）。 */
export const formatXxlJobEmptyText = (value?: string): string => {
  const text = String(value ?? '').trim();
  return text || '—';
};

/**
 * 组装调度中心要求的 filterTime：两侧空格的 ` - ` 分隔。
 * 只做格式组装，不校验日期语义；日期选择器已经保证输入形状。
 */
export const buildFilterTime = (range?: [string, string] | null): string => {
  if (!range || range.length !== 2) return '';
  const [start, end] = range.map((part) => String(part ?? '').trim());
  if (!start || !end) return '';
  return `${start} - ${end}`;
};

export type XxlJobWorkbenchProps = {
  connectionId: string;
  panel?: XxlJobPanel;
  isActive?: boolean;
};
