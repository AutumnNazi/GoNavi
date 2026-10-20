import type { DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { isJobID, jobLiteral, type DatabaseJobChildQueries, type DatabaseJobQueryGroup } from './jobQueryTypes';

const sqlServerJobID = (name: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
const sqlServerJobs = 'msdb.dbo.sysjobs';

export const sqlServerJobListQueries = (database: string): DatabaseJobQueryGroup[] => database.toLowerCase() !== 'msdb' ? [] : [{
  kind: 'sqlserver-agent',
  queries: [`SELECT CONVERT(varchar(36), job_id) AS job_name, name AS job_label, enabled FROM ${sqlServerJobs} ORDER BY name, job_id`],
}];

export const sqlServerJobDefinitionQueries = (id: string): string[] => !sqlServerJobID(id) ? [] : [
  `SELECT CONVERT(varchar(36), job_id) AS job_name, name AS job_label, enabled, description AS comments, SUSER_SNAME(owner_sid) AS owner, start_step_id, date_created AS create_time, date_modified, notify_level_eventlog, notify_level_email, notify_level_netsend, notify_level_page, delete_level FROM ${sqlServerJobs} WHERE job_id = ${jobLiteral(id)}`,
];

export const sqlServerJobChildQueries = (id: string): DatabaseJobChildQueries => !sqlServerJobID(id) ? {} : ({
  steps: [`SELECT step_id, step_name, subsystem AS step_type, command AS action, database_name, on_success_action AS success_action, on_success_step_id, on_fail_action AS failure_action, on_fail_step_id, retry_attempts, retry_interval FROM msdb.dbo.sysjobsteps WHERE job_id = ${jobLiteral(id)} ORDER BY step_id`],
  schedules: [`SELECT s.schedule_id, s.name AS schedule_name, s.enabled, s.freq_type, s.freq_interval, s.freq_subday_type, s.freq_subday_interval, s.freq_relative_interval, s.freq_recurrence_factor, s.active_start_date, s.active_end_date, s.active_start_time, s.active_end_time, j.next_run_date, j.next_run_time FROM msdb.dbo.sysjobschedules j JOIN msdb.dbo.sysschedules s ON s.schedule_id = j.schedule_id WHERE j.job_id = ${jobLiteral(id)} ORDER BY s.schedule_id`],
});

export const gaussJobListQueries = (kind: 'opengauss-job' | 'gaussdb-job'): DatabaseJobQueryGroup[] => [{
  kind,
  queries: [
    'SELECT job_id::text AS job_name, job_name AS job_label, enable AS enabled, job_status AS state, next_run_date AS next_run_at FROM pg_catalog.pg_job WHERE dbname = current_database() ORDER BY job_id',
    'SELECT job_id::text AS job_name, job_status AS state, next_run_date AS next_run_at FROM pg_catalog.pg_job WHERE dbname = current_database() ORDER BY job_id',
  ],
}];

export const gaussJobDefinitionQueries = (kind: DatabaseJobKind, id: string): string[] => (
  (kind !== 'opengauss-job' && kind !== 'gaussdb-job') || !isJobID(id) ? [] : [
    `SELECT job_id::text AS job_name, job_name AS job_label, job_id, log_user AS owner, priv_user, dbname AS database_name, nspname AS schema_name, job_status AS state, enable AS enabled, start_date, end_date, next_run_date AS next_run_at, interval AS repeat_interval, last_start_date, last_end_date, failure_count FROM pg_catalog.pg_job WHERE dbname = current_database() AND job_id = ${id}`,
    `SELECT job_id::text AS job_name, job_id, log_user AS owner, priv_user, dbname AS database_name, nspname AS schema_name, job_status AS state, start_date, next_run_date AS next_run_at, interval AS repeat_interval, last_start_date, last_end_date, failure_count FROM pg_catalog.pg_job WHERE dbname = current_database() AND job_id = ${id}`,
  ]
);

export const gaussJobChildQueries = (id: string): DatabaseJobChildQueries => !isJobID(id) ? {} : ({
  // Keep job properties even if the separate action catalog is inaccessible.
  steps: [`SELECT p.job_id AS step_id, p.what AS action FROM pg_catalog.pg_job_proc p JOIN pg_catalog.pg_job j ON j.job_id = p.job_id WHERE j.dbname = current_database() AND p.job_id = ${id}`],
});
