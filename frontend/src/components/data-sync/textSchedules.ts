import type { DataSyncRunEvent } from './model';
import type { DataSyncWorkbenchTranslate } from './text';

/**
 * Schedule and run-event copy owned by the data sync workbench. Kept beside the
 * schedule control so the fast-growing main catalog does not absorb these
 * keys; `text.ts` spreads both maps into its language catalogs.
 */
export const dataSyncScheduleTextsZhCN = {
  'schedules.title': '调度',
  'schedules.subtitle': '集中查看调度状态、最近运行和下一次执行。',
  'schedules.empty_title': '还没有定时调度的任务',
  'schedules.empty_desc': '在任务的“触发与增量”阶段选择指定时间或 Cron，暂停的任务也会在这里管理。',
  'schedules.task': '任务',
  'schedules.status': '调度状态',
  'schedules.trigger': '触发方式',
  'schedules.next_run': '下次执行',
  'schedules.latest_run': '最近运行',
  'schedules.actions': '操作',
  'schedules.enabled': '已启用',
  'schedules.disabled': '已暂停',
  'schedules.enable': '启用',
  'schedules.disable': '暂停',
  'schedules.run_now': '立即运行',
  'schedules.view_run': '查看运行记录',
  'schedules.no_runs': '暂无运行记录',
  'schedules.confirm_enable': '确定启用任务“{task}”吗？',
  'schedules.confirm_enable_warning': '启用前会重新执行预检；需要生产审批时将在编辑器中完成。',
  'schedules.confirm_disable': '确定暂停任务“{task}”吗？',
  'schedules.confirm_disable_warning': '在途运行会被取消，后续调度不会再触发。',
  'schedules.confirm_run_now': '确定立即运行任务“{task}”吗？',
  'schedules.confirm_run_now_warning': '将按当前已保存的任务定义立即排队执行。',
  'schedules.confirm_scope_source': '源端：{scope}',
  'schedules.confirm_scope_target': '目标端：{scope}',
  'schedules.preflight_required': '需要先在编辑器中完成预检或审批，再继续操作。',
  'schedules.task_missing': '任务不存在或已被删除，请刷新调度清单。',
  'schedules.unsaved_edits': '任务存在未保存的编辑，请先在编辑器中保存或放弃修改。',
} as const;

export type DataSyncScheduleTextKey = keyof typeof dataSyncScheduleTextsZhCN;

export const dataSyncScheduleTextsEnUS: Record<DataSyncScheduleTextKey, string> = {
  'schedules.title': 'Schedules',
  'schedules.subtitle': 'Review schedule state, recent runs, and next runs in one place.',
  'schedules.empty_title': 'No scheduled tasks yet',
  'schedules.empty_desc':
    'Choose a one-time or Cron trigger in the task editor; paused tasks are managed here too.',
  'schedules.task': 'Task',
  'schedules.status': 'State',
  'schedules.trigger': 'Trigger',
  'schedules.next_run': 'Next run',
  'schedules.latest_run': 'Latest run',
  'schedules.actions': 'Actions',
  'schedules.enabled': 'Enabled',
  'schedules.disabled': 'Paused',
  'schedules.enable': 'Enable',
  'schedules.disable': 'Pause',
  'schedules.run_now': 'Run now',
  'schedules.view_run': 'View run',
  'schedules.no_runs': 'No runs yet',
  'schedules.confirm_enable': 'Enable task "{task}"?',
  'schedules.confirm_enable_warning':
    'Preflight runs again before enabling; production approval completes in the editor.',
  'schedules.confirm_disable': 'Pause task "{task}"?',
  'schedules.confirm_disable_warning':
    'In-flight runs are cancelled and no further schedules fire.',
  'schedules.confirm_run_now': 'Run task "{task}" now?',
  'schedules.confirm_run_now_warning':
    'The run queues immediately with the currently saved task definition.',
  'schedules.confirm_scope_source': 'Source: {scope}',
  'schedules.confirm_scope_target': 'Target: {scope}',
  'schedules.preflight_required':
    'Complete preflight or approval in the editor first, then continue.',
  'schedules.task_missing': 'The task no longer exists; refresh the schedule list.',
  'schedules.unsaved_edits':
    'The task has unsaved edits; save or discard them in the editor first.',
};

export const dataSyncRunEventTextsZhCN = {
  'metadata.saved_connection_missing': '原连接已不存在，请重新选择已保存连接。',
  'events.type.queued': '已排队',
  'events.type.started': '已开始',
  'events.type.progress': '运行进度',
  'events.type.checkpoint': '进度已保存',
  'events.type.error_row': '错误行',
  'events.type.log': '运行日志',
  'events.type.cancelling': '正在取消',
  'events.type.canceled': '已取消',
  'events.type.succeeded': '运行成功',
  'events.type.partial': '部分完成',
  'events.type.failed': '运行失败',
  'events.type.interrupted': '运行中断',
  'events.stage.running': '运行中',
  'events.stage.completed': '已完成',
  'events.stage.watermark': '水位线增量',
  'events.stage.streaming': '持续同步',
  'events.stage.checkpoint': '保存进度',
  'events.stage.mapping_completed': '对象已完成',
  'events.stage.write': '写入中',
  'events.message.checkpoint_saved': '同步进度已保存',
  'events.message.job_completed': '数据同步任务已完成',
  'events.message.watermark_completed': '水位线同步任务已完成',
  'events.message.cancellation_requested': '已请求取消运行',
  'events.message.cancellation_archived': '任务归档，已请求取消运行',
  'events.message.canceled_archived': '任务归档，运行已取消',
  'events.message.canceled_before_execution': '运行开始前已取消',
  'events.message.canceled_after_restart': '管理器重启后运行已取消',
  'events.message.interrupted_after_restart': '管理器重启后运行已中断',
  'events.message.resume_not_queued': '未能自动排队继续运行',
  'events.message.stopped_before_execution': '运行开始前管理器已停止',
  'events.message.stopped_during_execution': '运行中管理器已停止',
  'events.message.retry_mapping': '对象重试第 {current} 次',
  'events.message.retry_watermark': '水位线重试第 {current} 次',
  'events.message.mapping': '正在处理对象 {current}/{total}',
  'events.message.watermark': '正在处理水位线对象 {current}/{total}',
  'events.message.cdc_committed': 'CDC 事务 {current} 已提交',
} as const;

export const dataSyncRunEventTextsEnUS: Record<keyof typeof dataSyncRunEventTextsZhCN, string> = {
  'metadata.saved_connection_missing': 'The saved connection no longer exists. Select another saved connection.',
  'events.type.queued': 'Queued',
  'events.type.started': 'Started',
  'events.type.progress': 'Progress',
  'events.type.checkpoint': 'Checkpoint saved',
  'events.type.error_row': 'Error row',
  'events.type.log': 'Run log',
  'events.type.cancelling': 'Cancelling',
  'events.type.canceled': 'Canceled',
  'events.type.succeeded': 'Succeeded',
  'events.type.partial': 'Partially completed',
  'events.type.failed': 'Failed',
  'events.type.interrupted': 'Interrupted',
  'events.stage.running': 'Running',
  'events.stage.completed': 'Completed',
  'events.stage.watermark': 'Watermark sync',
  'events.stage.streaming': 'Streaming',
  'events.stage.checkpoint': 'Saving checkpoint',
  'events.stage.mapping_completed': 'Object completed',
  'events.stage.write': 'Writing',
  'events.message.checkpoint_saved': 'Checkpoint saved',
  'events.message.job_completed': 'Data sync job completed',
  'events.message.watermark_completed': 'Watermark sync job completed',
  'events.message.cancellation_requested': 'Cancellation requested',
  'events.message.cancellation_archived': 'Cancellation requested because the task was archived',
  'events.message.canceled_archived': 'Canceled because the task was archived',
  'events.message.canceled_before_execution': 'Canceled before execution',
  'events.message.canceled_after_restart': 'Canceled after manager restart',
  'events.message.interrupted_after_restart': 'Interrupted after manager restart',
  'events.message.resume_not_queued': 'Automatic resume was not queued',
  'events.message.stopped_before_execution': 'Manager stopped before execution',
  'events.message.stopped_during_execution': 'Manager stopped during execution',
  'events.message.retry_mapping': 'Mapping retry attempt {current}',
  'events.message.retry_watermark': 'Watermark retry attempt {current}',
  'events.message.mapping': 'Running object {current}/{total}',
  'events.message.watermark': 'Running watermark object {current}/{total}',
  'events.message.cdc_committed': 'CDC transaction {current} committed',
};

const standardMessages: Record<string, keyof typeof dataSyncRunEventTextsZhCN> = {
  queued: 'events.type.queued',
  started: 'events.type.started',
  'run started': 'events.type.started',
  'checkpoint saved': 'events.message.checkpoint_saved',
  'data sync job completed': 'events.message.job_completed',
  'watermark data sync job completed': 'events.message.watermark_completed',
  'cancellation requested': 'events.message.cancellation_requested',
  'cancellation requested because task was archived': 'events.message.cancellation_archived',
  'canceled because task was archived': 'events.message.canceled_archived',
  'canceled before execution': 'events.message.canceled_before_execution',
  'canceled after manager restart': 'events.message.canceled_after_restart',
  'interrupted after manager restart': 'events.message.interrupted_after_restart',
  'automatic resume was not queued': 'events.message.resume_not_queued',
  'manager stopped before execution': 'events.message.stopped_before_execution',
  'manager stopped during execution': 'events.message.stopped_during_execution',
  canceled: 'events.type.canceled',
};

export const formatDataSyncRunEvent = (event: DataSyncRunEvent, t: DataSyncWorkbenchTranslate) => {
  const stageKey = `events.stage.${event.stage}` as keyof typeof dataSyncRunEventTextsZhCN;
  const stage = event.stage && stageKey in dataSyncRunEventTextsZhCN ? t(stageKey) : event.stage || '';
  let message = event.message;
  const standardKey = Object.prototype.hasOwnProperty.call(standardMessages, message)
    ? standardMessages[message] : undefined;
  if (standardKey) message = t(standardKey);
  else if (message === event.stage && stage) message = stage;
  else {
    const mapping = /^running (watermark )?mapping (\d+)\/(\d+)$/.exec(message);
    const cdc = /^CDC transaction (\d+) committed$/.exec(message);
    const retry = /^(watermark|mapping) attempt (\d+) failed; retrying$/.exec(message);
    if (mapping) message = t(mapping[1] ? 'events.message.watermark' : 'events.message.mapping', {
      current: mapping[2], total: mapping[3],
    });
    else if (cdc) message = t('events.message.cdc_committed', { current: cdc[1] });
    else if (retry) message = t(retry[1] === 'watermark' ? 'events.message.retry_watermark' : 'events.message.retry_mapping', { current: retry[2] });
  }
  return { type: t(`events.type.${event.type}`), stage, message };
};
