/**
 * Schedule-list copy owned by the data sync workbench. Kept beside the
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
