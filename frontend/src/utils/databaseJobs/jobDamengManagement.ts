import type { JobCreateInput, JobOperation, JobSnapshot, JobTarget } from './jobManagementTypes';
import { numberValue, numericID, plBlock, required, sqlText } from './jobManagementSQL';

export const damengManagementSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  const name = sqlText(operation === 'create' ? input.name : target.name);
  if (operation === 'create') return plBlock([
    ...(target.owner ? [`IF USER <> ${sqlText(target.owner)} THEN RAISE_APPLICATION_ERROR(-20001, 'Create the job with its owner login'); END IF`] : []),
    `SP_CREATE_JOB(${name}, 0, 0, '', 0, 0, '', 0, '')`,
    `SP_JOB_CONFIG_START(${name})`,
    `SP_ADD_JOB_STEP(${name}, 'step_1', 0, ${sqlText(input.action)}, 0, 0, 0, 0, NULL, 0)`,
    `SP_ADD_JOB_SCHEDULE(${name}, 'schedule_1', 1, 1, 1, 0, 0, '00:00:00', '23:59:59', TO_CHAR(SYSDATE, 'YYYY-MM-DD'), NULL, '')`,
    `SP_JOB_CONFIG_COMMIT(${name})`,
  ]);
  if (operation === 'drop') return plBlock([`SP_DROP_JOB(${name})`]);
  if (operation === 'enable' || operation === 'disable') return plBlock([`SP_ENABLE_JOB(${name}, ${operation === 'enable' ? 1 : 0})`]);
  if (operation === 'run' || operation === 'stop') return plBlock([`${operation === 'run' ? 'SP_DBMS_JOB_RUN_ASYNC' : 'SP_STOP_RUNNING_JOB'}(${numericID(required(snapshot.job, 'job_id'))})`]);
  if (operation !== 'edit') return '';
  const mainFields = ['enable', 'enable_email', 'email_operator_name', 'email_type', 'enable_netsend', 'netsend_operator_name', 'netsend_type', 'describe'];
  const numeric = new Set(['enable', 'enable_email', 'email_type', 'enable_netsend', 'netsend_type']);
  const args = mainFields.map(key => (numeric.has(key) ? numberValue : sqlText)(required(snapshot.job, key)));
  const calls = [`SP_ALTER_JOB(${name}, ${args.join(', ')})`, `SP_JOB_CONFIG_START(${name})`];
  for (const step of snapshot.steps) {
    const fields = ['name', 'type', 'command', 'succ_action', 'fail_action', 'retry_attempts', 'retry_interval', 'output_file_path', 'append_flag'];
    const numbers = new Set(['type', 'succ_action', 'fail_action', 'retry_attempts', 'retry_interval', 'append_flag']);
    calls.push(`SP_ALTER_JOB_STEP(${name}, ${fields.map(key => (numbers.has(key) ? numberValue : sqlText)(required(step, key))).join(', ')})`);
  }
  for (const schedule of snapshot.schedules) {
    const fields = ['name', 'enable', 'type', 'freq_interval', 'freq_sub_interval', 'freq_minute_interval', 'starttime', 'endtime', 'during_start_date', 'during_end_date', 'describe'];
    const numbers = new Set(['enable', 'type', 'freq_interval', 'freq_sub_interval', 'freq_minute_interval']);
    calls.push(`SP_ALTER_JOB_SCHEDULE(${name}, ${fields.map(key => (numbers.has(key) ? numberValue : sqlText)(required(schedule, key))).join(', ')})`);
  }
  calls.push(`SP_JOB_CONFIG_COMMIT(${name})`);
  // A single driver request keeps DM's configuration operations on the same session.
  return plBlock(calls);
};
