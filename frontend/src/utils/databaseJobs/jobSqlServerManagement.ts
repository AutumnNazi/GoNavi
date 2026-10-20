import type { JobCreateInput, JobOperation, JobSnapshot, JobTarget } from './jobManagementTypes';
import { guid, numberValue, numericID, required, sqlText, value } from './jobManagementSQL';

const unicode = (v: unknown): string => v == null ? 'NULL' : `N${sqlText(v)}`;
export const sqlServerBatch = (calls: string[], declarations = ''): string => `SET XACT_ABORT ON;\nDECLARE @rc int;\n${declarations}\nBEGIN TRY\n  BEGIN TRANSACTION;\n${calls.map(call => `  EXEC @rc = ${call};\n  IF @rc <> 0 THROW 51000, 'Job operation failed', 1;`).join('\n')}\n  COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH\n  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;\n  THROW;\nEND CATCH;`;

export const sqlServerManagementSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (target.database.toLowerCase() !== 'msdb') throw new Error('database_jobs.manage.invalid_identity');
  if (operation === 'create') return sqlServerBatch([
    `msdb.dbo.sp_add_job @job_name=${unicode(input.name)}, @enabled=0, @job_id=@job_id OUTPUT`,
    `msdb.dbo.sp_add_jobstep @job_id=@job_id, @step_name=N'step_1', @subsystem=N'TSQL', @command=${unicode(input.action)}, @database_name=N'master'`,
    `msdb.dbo.sp_add_jobschedule @job_id=@job_id, @name=N'schedule_1', @enabled=1, @freq_type=4, @freq_interval=1, @active_start_time=0`,
    'msdb.dbo.sp_add_jobserver @job_id=@job_id',
  ], 'DECLARE @job_id uniqueidentifier;');
  const id = guid(target.name);
  const actions: Partial<Record<JobOperation, string>> = {
    drop: `msdb.dbo.sp_delete_job @job_id=${id}, @delete_unused_schedule=0`,
    enable: `msdb.dbo.sp_update_job @job_id=${id}, @enabled=1`,
    disable: `msdb.dbo.sp_update_job @job_id=${id}, @enabled=0`,
    run: `msdb.dbo.sp_start_job @job_id=${id}`, stop: `msdb.dbo.sp_stop_job @job_id=${id}`,
  };
  // Start/stop are agent operations; do not wrap them in a user transaction.
  if (operation === 'run' || operation === 'stop') return `DECLARE @rc int;\nEXEC @rc = ${actions[operation]};\nIF @rc <> 0 THROW 51000, 'Job operation failed', 1;`;
  if (actions[operation]) return sqlServerBatch([actions[operation]!]);
  if (operation !== 'edit') return '';
  const calls = [`msdb.dbo.sp_update_job @job_id=${id}, @new_name=${unicode(required(snapshot.job, 'job_label'))}, @description=${unicode(required(snapshot.job, 'comments'))}, @start_step_id=${numericID(required(snapshot.job, 'start_step_id'))}`];
  for (const step of snapshot.steps) {
    const fields = ['step_name', 'subsystem', 'command', 'database_name', 'on_success_action', 'on_success_step_id', 'on_fail_action', 'on_fail_step_id', 'retry_attempts', 'retry_interval'];
    const aliases: Record<string, string> = { subsystem: 'step_type', command: 'action', on_success_action: 'success_action', on_fail_action: 'failure_action' };
    const textFields = new Set(['step_name', 'subsystem', 'command', 'database_name']);
    const params = fields.map(key => `@${key}=${(textFields.has(key) ? unicode : numberValue)(required(step, aliases[key] || key))}`);
    calls.push(`msdb.dbo.sp_update_jobstep @job_id=${id}, @step_id=${numericID(required(step, 'step_id'))}, ${params.join(', ')}`);
  }
  for (const schedule of snapshot.schedules) {
    const fields = ['enabled', 'freq_type', 'freq_interval', 'freq_subday_type', 'freq_subday_interval', 'freq_relative_interval', 'freq_recurrence_factor', 'active_start_date', 'active_end_date', 'active_start_time', 'active_end_time'];
    const params = fields.filter(key => value(schedule, key) !== undefined).map(key => `@${key}=${numberValue(value(schedule, key))}`);
    // Shared schedules are not silently altered for other jobs. The batch refuses such changes.
    const scheduleID = numericID(required(schedule, 'schedule_id'));
    calls.push(`msdb.dbo.sp_update_schedule @schedule_id=${scheduleID}, @new_name=${unicode(required(schedule, 'schedule_name'))}, ${params.join(', ')}`);
  }
  const guards = snapshot.schedules.map(s => `IF (SELECT COUNT(*) FROM msdb.dbo.sysjobschedules WHERE schedule_id=${numericID(required(s, 'schedule_id'))}) > 1 THROW 51001, 'Shared schedule: detach and create a private schedule before editing', 1;`).join('\n');
  return sqlServerBatch(calls, guards);
};
