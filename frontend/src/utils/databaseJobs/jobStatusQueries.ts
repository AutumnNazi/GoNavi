import type { JobSnapshot, JobTarget } from './jobManagementTypes';
import { buildDatabaseJobDefinitionQueries } from './jobQueries';
import { guid, mysqlText, numericID, required, sqlText } from './jobManagementSQL';
import { eventMetadataSQL } from './jobEventManagement';

export const jobStatusSQL = (target: JobTarget, snapshot: JobSnapshot): string => {
  const { kind, name } = target;
  if (kind === 'mysql-event') return eventMetadataSQL(target);
  if (kind === 'sqlserver-agent') return `SELECT j.name, j.enabled, a.run_requested_date, a.start_execution_date, a.stop_execution_date, a.last_executed_step_id, a.next_scheduled_run_date FROM msdb.dbo.sysjobs j LEFT JOIN msdb.dbo.sysjobactivity a ON a.job_id = j.job_id AND a.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions) WHERE j.job_id = ${guid(name)}`;
  if (kind === 'pgagent') return `SELECT jobid, jobname, jobenabled, jobagentid AS running_agent_id, jobnextrun, joblastrun FROM pgagent.pga_job WHERE jobid = ${numericID(name)}`;
  if (kind === 'pg-cron') return `SELECT j.jobid, j.schedule, j.database, j.username, j.active, r.runid, r.status, r.return_message, r.start_time, r.end_time FROM cron.job j LEFT JOIN LATERAL (SELECT runid, status, return_message, start_time, end_time FROM cron.job_run_details WHERE jobid = j.jobid ORDER BY runid DESC LIMIT 1) r ON TRUE WHERE j.jobid = ${numericID(name)}`;
  if (kind === 'dm-agent') return `SELECT j.NAME, j.ENABLE, j.VALID, r.SID AS running_session, r.THIS_DATE AS running_since, r.INSTANCE FROM SYSJOB.SYSJOBS j LEFT JOIN V$JOBS_RUNNING r ON r.JOBID = j.ID WHERE j.ID = ${numericID(required(snapshot.job, 'job_id'))} AND j.USERNAME = ${sqlText(target.owner)}`;
  if (kind === 'starrocks-task') return `SELECT * FROM information_schema.tasks WHERE TASK_NAME = ${mysqlText(name)} AND \`DATABASE\` = ${mysqlText(target.database)}`;
  const queries = buildDatabaseJobDefinitionQueries(target.dialect, kind, target.owner, name, target.database);
  return queries[snapshot.definitionQueryIndex ?? 0] || '';
};
