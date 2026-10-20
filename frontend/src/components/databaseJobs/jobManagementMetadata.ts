import { DBQuery } from '../../../wailsjs/go/app/App';
import type { SavedConnection } from '../../types';
import type { DatabaseJobQueryExecutor } from '../../typeDefs/databaseJobTypes';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import { buildDatabaseJobDefinitionQueries } from '../../utils/databaseJobs/jobQueries';
import { extendedJobChildQueries } from '../../utils/databaseJobs/jobProviderQueries';
import { runDatabaseJobQueries } from '../../utils/databaseJobs/jobMetadata';
import { sqlText } from '../../utils/databaseJobs/jobManagementSQL';
import type { JobSnapshot, JobTarget } from '../../utils/databaseJobs/jobManagementTypes';
import { eventMetadataSQL, eventShowCreateSQL } from '../../utils/databaseJobs/jobEventManagement';
import { readDatabaseJobText } from '../../utils/databaseJobs/jobMetadata';

export const loadJobManagementSnapshot = async (target: JobTarget, execute: DatabaseJobQueryExecutor, editable = true): Promise<JobSnapshot> => {
  if (target.kind === 'mysql-event') return loadEventSnapshot(target, execute);
  const jobQueries = target.kind === 'dm-agent' && editable ? dmMetadataQueries(target, 'jobs')
    : buildDatabaseJobDefinitionQueries(target.dialect, target.kind, target.owner, target.name, target.database);
  const job = await runDatabaseJobQueries(jobQueries, execute, 'database_jobs.error.query_failed');
  if (!job.success) throw new Error(job.message);
  if (job.rows.length !== 1) throw new Error('database_jobs.error.not_found');
  const snapshot: JobSnapshot = {
    job: job.rows[0], steps: [], schedules: [],
    ...(job.queryIndex !== undefined ? { definitionQueryIndex: job.queryIndex } : {}),
  };
  if (!editable) return snapshot;
  const children = target.kind === 'dm-agent'
    ? { steps: dmMetadataQueries(target, 'steps'), schedules: dmMetadataQueries(target, 'schedules') }
    : extendedJobChildQueries(target.kind, target.name);
  // Editing is stricter than viewing: never build an edit from an incomplete child snapshot.
  for (const part of ['steps', 'schedules'] as const) {
    if (!children[part]) continue;
    const result = await runDatabaseJobQueries(children[part]!, execute, 'database_jobs.error.query_failed');
    if (!result.success) throw new Error(result.message);
    snapshot[part] = result.rows;
  }
  return snapshot;
};

const loadEventSnapshot = async (target: JobTarget, execute: DatabaseJobQueryExecutor): Promise<JobSnapshot> => {
  const metadata = await runDatabaseJobQueries([eventMetadataSQL(target)], execute, 'database_jobs.error.query_failed');
  if (!metadata.success) throw new Error(metadata.message);
  if (metadata.rows.length !== 1) throw new Error('database_jobs.error.not_found');
  const ddl = await runDatabaseJobQueries([eventShowCreateSQL(target)], execute, 'database_jobs.error.query_failed');
  if (!ddl.success || !ddl.rows.length) throw new Error(ddl.message || 'database_jobs.manage.incomplete_metadata');
  return { job: { ...metadata.rows[0], create_event: readDatabaseJobText(ddl.rows[0], 'Create Event') }, steps: [], schedules: [] };
};

const dmMetadataQueries = (target: JobTarget, part: 'jobs' | 'steps' | 'schedules'): string[] => {
  const where = `j.USERNAME = ${sqlText(target.owner)} AND j.NAME = ${sqlText(target.name)}`;
  return ['SYS', 'USER'].map(scope => {
    const jobs = scope === 'SYS' ? 'SYSJOB.SYSJOBS' : 'SYSJOB.USER_JOBS_VIEW';
    if (part === 'jobs') return `SELECT j.*, j.ID AS job_id, em.NAME AS email_operator_name, ns.NAME AS netsend_operator_name FROM ${jobs} j LEFT JOIN SYSJOB.SYSOPERATORS em ON em.ID = j.EMAIL_OPERID LEFT JOIN SYSJOB.SYSOPERATORS ns ON ns.ID = j.NETSEND_OPERID WHERE ${where}`;
    const table = part === 'steps' ? (scope === 'SYS' ? 'SYSJOB.SYSJOBSTEPS' : 'SYSJOB.USER_JOBSTEPS_VIEW') : (scope === 'SYS' ? 'SYSJOB.SYSJOBSCHEDULES' : 'SYSJOB.USER_JOBSCHEDULES_VIEW');
    return `SELECT c.* FROM ${table} c JOIN ${jobs} j ON j.ID = c.JOBID WHERE ${where} ORDER BY c.${part === 'steps' ? 'SEQNO' : 'ID'}`;
  });
};

export const createJobMetadataExecutor = (connection: SavedConnection, database: string): DatabaseJobQueryExecutor => (
  sql => DBQuery(buildRpcConnectionConfig(connection.config), database, sql)
);
