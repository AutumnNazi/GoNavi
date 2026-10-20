import type { JobCreateInput, JobOperation, JobSnapshot, JobTarget } from './jobManagementTypes';
import { booleanValue, numericID, pgBlock, pgText, required, value } from './jobManagementSQL';

export const postgresManagementSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (target.kind === 'pgagent') return pgAgentSQL(target, operation, snapshot, input);
  if (target.kind === 'opengauss-job' || target.kind === 'gaussdb-job') return gaussJobSQL(target, operation, snapshot, input);
  if (operation === 'create') return pgBlock([
    `PERFORM pg_advisory_xact_lock(hashtext(current_user || ':' || ${pgText(input.name)})::bigint)`,
    `IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${pgText(input.name)} AND username = current_user) THEN RAISE EXCEPTION 'Job name already exists'; END IF`,
    `SELECT cron.schedule(${pgText(input.name)}, ${pgText(input.schedule)}, ${pgText(input.action)}) INTO new_job_id`,
    'PERFORM cron.alter_job(new_job_id, active := FALSE)',
  ], '  new_job_id bigint;');
  const id = numericID(target.name);
  if (operation === 'drop') return `SELECT cron.unschedule(${id});`;
  if (operation === 'enable' || operation === 'disable') return `SELECT cron.alter_job(${id}, active := ${operation === 'enable' ? 'TRUE' : 'FALSE'});`;
  if (operation === 'edit') return `SELECT cron.alter_job(${id}, schedule := ${pgText(required(snapshot.job, 'repeat_interval'))}, command := ${pgText(required(snapshot.job, 'action'))}, database := ${pgText(required(snapshot.job, 'database_name'))});`;
  return '';
};

const pgBooleanArray = (v: unknown): string => {
  if (Array.isArray(v)) return `ARRAY[${v.map(booleanValue).join(', ')}]::boolean[]`;
  const text = String(v ?? '');
  if (!/^\{(?:[tf]|true|false)(?:,(?:[tf]|true|false))*\}$/i.test(text)) throw new Error('database_jobs.manage.incomplete_metadata');
  return `${pgText(text)}::boolean[]`;
};

const pgAgentSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (operation === 'create') return pgBlock([
    `INSERT INTO pgagent.pga_job (jobjclid, jobname, jobenabled) VALUES ((SELECT min(jclid) FROM pgagent.pga_jobclass), ${pgText(input.name)}, FALSE) RETURNING jobid INTO new_job_id`,
    `INSERT INTO pgagent.pga_jobstep (jstjobid, jstname, jstkind, jstcode, jstdbname) VALUES (new_job_id, 'step_1', 's', ${pgText(input.action)}, ${pgText(target.database)})`,
    `INSERT INTO pgagent.pga_schedule (jscjobid, jscname, jscenabled, jscminutes, jschours, jscweekdays, jscmonthdays, jscmonths) VALUES (new_job_id, 'schedule_1', TRUE, ARRAY[TRUE] || array_fill(FALSE, ARRAY[59]), ARRAY[TRUE] || array_fill(FALSE, ARRAY[23]), array_fill(TRUE, ARRAY[7]), array_fill(TRUE, ARRAY[32]), array_fill(TRUE, ARRAY[12]))`,
  ], '  new_job_id integer;');
  const id = numericID(target.name);
  if (operation === 'drop') return `DELETE FROM pgagent.pga_job WHERE jobid = ${id};`;
  if (operation === 'enable' || operation === 'disable') return `UPDATE pgagent.pga_job SET jobenabled = ${operation === 'enable' ? 'TRUE' : 'FALSE'} WHERE jobid = ${id};`;
  // Native pgAdmin Run now semantics: request a run from the agent, never execute SQL as the UI login.
  if (operation === 'run') return pgBlock([`UPDATE pgagent.pga_job SET jobnextrun = now() WHERE jobid = ${id} AND jobenabled AND jobagentid IS NULL`, "IF NOT FOUND THEN RAISE EXCEPTION 'Job disabled, already running, or missing'; END IF"]);
  if (operation !== 'edit') return '';
  const statements = [`UPDATE pgagent.pga_job SET jobname = ${pgText(required(snapshot.job, 'job_label'))}, jobdesc = ${pgText(required(snapshot.job, 'comments'))} WHERE jobid = ${id}`];
  for (const step of snapshot.steps) statements.push(
    `UPDATE pgagent.pga_jobstep SET jstname = ${pgText(required(step, 'step_name'))}, jstkind = ${pgText(required(step, 'step_type'))}, jstcode = ${pgText(required(step, 'action'))}, jstdbname = ${pgText(required(step, 'database_name'))}, jstenabled = ${booleanValue(required(step, 'enabled'))}, jstonerror = ${pgText(required(step, 'failure_action'))} WHERE jstjobid = ${id} AND jstid = ${numericID(required(step, 'step_id'))}`,
  );
  const seen = new Set<string>();
  for (const schedule of snapshot.schedules) {
    const scheduleID = numericID(required(schedule, 'schedule_id'));
    if (seen.has(scheduleID)) continue;
    seen.add(scheduleID);
    const arrays = ['jscminutes', 'jschours', 'jscweekdays', 'jscmonthdays', 'jscmonths'].map(key => `${key} = ${pgBooleanArray(required(schedule, key))}`);
    statements.push(`UPDATE pgagent.pga_schedule SET jscname = ${pgText(required(schedule, 'schedule_name'))}, jscenabled = ${booleanValue(required(schedule, 'enabled'))}, jscstart = ${pgText(required(schedule, 'start_date'))}::timestamptz, jscend = ${pgText(value(schedule, 'end_date'))}::timestamptz, ${arrays.join(', ')} WHERE jscjobid = ${id} AND jscid = ${scheduleID}`);
  }
  // Exceptions and connection strings are preserved, not deleted/reconstructed.
  return pgBlock(statements);
};

const gaussJobSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  const gauss = target.kind === 'gaussdb-job';
  if (operation === 'create') return gauss
    ? `SELECT DBE_TASK.SUBMIT(NULL, ${pgText(input.action)}, CURRENT_TIMESTAMP + INTERVAL '1 day', ${pgText(input.schedule || 'null')});`
    : `SELECT PKG_SERVICE.JOB_SUBMIT(NULL, ${pgText(input.action)}, CURRENT_TIMESTAMP + INTERVAL '1 day', ${pgText(input.schedule || 'null')});`;
  const id = numericID(target.name);
  const pkg = gauss ? 'DBE_TASK' : 'PKG_SERVICE';
  const method = (modern: string, legacy: string) => `${pkg}.${gauss ? modern : legacy}`;
  if (operation === 'drop') return `SELECT ${method('CANCEL', 'JOB_CANCEL')}(${id});`;
  if (operation === 'enable' || operation === 'disable') return `SELECT ${method('FINISH', 'JOB_FINISH')}(${id}, ${operation === 'disable' ? 'TRUE' : 'FALSE'}, CURRENT_TIMESTAMP);`;
  if (operation === 'edit') return `SELECT ${method('UPDATE', 'JOB_UPDATE')}(${id}, NULL, ${pgText(required(snapshot.job, 'repeat_interval'))}, ${pgText(required(snapshot.steps[0] || {}, 'action'))});`;
  return '';
};
