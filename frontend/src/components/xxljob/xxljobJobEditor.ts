// 任务编辑器的纯函数层：枚举字典、表单值 ↔ RPC 载荷映射、调度配置校验。
// 枚举值与官方 xxl-job 对齐（ExecutorRouteStrategyEnum / ExecutorBlockStrategyEnum
// / MisfireStrategyEnum / ScheduleTypeEnum / GlueTypeEnum）。
import type { XxlJobGroupOption } from './hooks/useXxlJobGroups';
import type { XxlJobInfo } from './xxljobModel';
import type { XxlJobJobMutationPayload } from './xxljobRpc';

// 路由策略：官方枚举值（发送给后端的字符串）。
export const ROUTE_STRATEGIES = [
  'FIRST',
  'LAST',
  'ROUND',
  'RANDOM',
  'CONSISTENT_HASH',
  'LEAST_FREQUENTLY_USED',
  'LEAST_RECENTLY_USED',
  'FAILOVER',
  'BUSYOVER',
  'SHARDING_BROADCAST',
] as const;

// 阻塞处理策略。
export const BLOCK_STRATEGIES = ['SERIAL_EXECUTION', 'DISCARD_LATER', 'COVER_EARLY'] as const;

// 调度过期（misfire）策略。
export const MISFIRE_STRATEGIES = ['DO_NOTHING', 'FIRE_ONCE_NOW'] as const;

// 调度类型。官方 3.x 注释掉了 FIX_DELAY，只发 NONE/CRON/FIX_RATE。
export const SCHEDULE_TYPES = ['NONE', 'CRON', 'FIX_RATE'] as const;

// GLUE 类型：BEAN 之外都是在线代码模式。
export const GLUE_TYPES = [
  'BEAN',
  'GLUE_GROOVY',
  'GLUE_SHELL',
  'GLUE_PYTHON',
  'GLUE_NODEJS',
  'GLUE_POWERSHELL',
  'GLUE_PHP',
] as const;

// GLUE 类型 → Monaco 语言，供代码编辑器切换语法高亮。
export const GLUE_MONACO_LANGUAGE: Record<string, string> = {
  GLUE_GROOVY: 'java',
  GLUE_SHELL: 'shell',
  GLUE_PYTHON: 'python',
  GLUE_NODEJS: 'javascript',
  GLUE_POWERSHELL: 'powershell',
  GLUE_PHP: 'php',
};

// 调度类型 → Monaco 无关，仅用于表单提示（调度配置的含义随类型变化）。
export const SCHEDULE_CONF_HINT_KEY: Record<string, string> = {
  NONE: 'xxljob.hint.schedule_conf_none',
  CRON: 'xxljob.hint.schedule_conf_cron',
  FIX_RATE: 'xxljob.hint.schedule_conf_fix_rate',
};

export type JobFormValues = {
  jobGroup: number;
  name: string;
  author: string;
  alarmEmail?: string;
  scheduleType: string;
  scheduleConf?: string;
  misfireStrategy: string;
  executorRouteStrategy: string;
  executorHandler?: string;
  executorParam?: string;
  executorBlockStrategy: string;
  executorTimeout?: number;
  executorFailRetryCount?: number;
  glueType: string;
  glueSource?: string;
  childJobId?: string;
  triggerStatus: number;
};

// 表单值 → RPC 载荷。超时/重试为空时按官方默认（-1 表示沿用系统默认）。
export const buildJobMutationPayload = (
  values: JobFormValues,
  editingId: number,
): XxlJobJobMutationPayload => ({
  id: editingId,
  jobGroup: values.jobGroup,
  name: values.name.trim(),
  author: values.author.trim(),
  alarmEmail: values.alarmEmail?.trim() ?? '',
  scheduleType: values.scheduleType,
  scheduleConf: values.scheduleType === 'NONE' ? '' : (values.scheduleConf ?? '').trim(),
  misfireStrategy: values.misfireStrategy,
  executorRouteStrategy: values.executorRouteStrategy,
  executorHandler: values.glueType === 'BEAN' ? (values.executorHandler ?? '').trim() : '',
  executorParam: values.executorParam ?? '',
  executorBlockStrategy: values.executorBlockStrategy,
  executorTimeout: values.executorTimeout ?? -1,
  executorFailRetryCount: values.executorFailRetryCount ?? -1,
  glueType: values.glueType,
  glueSource: values.glueType === 'BEAN' ? '' : (values.glueSource ?? ''),
  // 新建 GLUE 任务时官方用固定备注初始化源码版本。
  glueRemark: values.glueType === 'BEAN' ? '' : 'GLUE代码初始化',
  childJobId: values.childJobId?.trim() ?? '',
  triggerStatus: values.triggerStatus,
});

// 已有任务 → 表单初始值（编辑模式）。
export const buildJobFormValues = (job: XxlJobInfo): JobFormValues => ({
  jobGroup: job.jobGroup,
  name: job.name,
  author: job.author ?? '',
  alarmEmail: job.alarmEmail ?? '',
  scheduleType: job.scheduleType || 'CRON',
  scheduleConf: job.scheduleConf ?? '',
  misfireStrategy: job.misfireStrategy || 'DO_NOTHING',
  executorRouteStrategy: job.executorRouteStrategy || 'FIRST',
  executorHandler: job.executorHandler ?? '',
  executorParam: job.executorParam ?? '',
  executorBlockStrategy: job.executorBlockStrategy || 'SERIAL_EXECUTION',
  executorTimeout: job.executorTimeout,
  executorFailRetryCount: job.executorFailRetryCount,
  glueType: job.glueType || 'BEAN',
  childJobId: job.childJobId ?? '',
  triggerStatus: job.triggerStatus,
});

// 新建任务的默认值，与官方 add 表单一致。
export const emptyJobFormValues = (defaultJobGroup?: number): JobFormValues => ({
  jobGroup: defaultJobGroup ?? 0,
  name: '',
  author: '',
  alarmEmail: '',
  scheduleType: 'CRON',
  scheduleConf: '',
  misfireStrategy: 'DO_NOTHING',
  executorRouteStrategy: 'FIRST',
  executorHandler: '',
  executorParam: '',
  executorBlockStrategy: 'SERIAL_EXECUTION',
  executorTimeout: -1,
  executorFailRetryCount: -1,
  glueType: 'BEAN',
  glueSource: '',
  childJobId: '',
  triggerStatus: 0,
});

// 调度配置按类型校验：CRON 交给后端 nextTriggerTime 实时验证，
// FIX_RATE 必须是正整数秒，NONE 无配置。
export const validateScheduleConf = (scheduleType: string, conf?: string): string | null => {
  if (scheduleType === 'NONE') return null;
  const trimmed = (conf ?? '').trim();
  if (!trimmed) return 'xxljob.validation.schedule_conf_required';
  if (scheduleType === 'FIX_RATE' && !/^\d+$/.test(trimmed)) {
    return 'xxljob.validation.schedule_conf_fix_rate';
  }
  return null;
};

// 枚举选项生成：label 走 i18n（xxljob.enum.*），value 是官方枚举字符串。
export const enumOptions = (values: readonly string[], prefix: string) =>
  values.map((value) => ({ label: `xxljob.enum.${prefix}.${value}`, value }));

// 执行器下拉选项（表单内复用侧边栏的分组选项）。
export const jobGroupOptions = (groups: XxlJobGroupOption[]) =>
  groups.map((group) => ({ label: group.label, value: group.value }));
