import { buildDatabaseJobListQueries } from './jobQueries';
import { supportedJobOperations, type JobCreateInput, type JobOperation, type JobSnapshot, type JobSQLPlan, type JobTarget } from './jobManagementTypes';
import { schedulerManagementSQL } from './jobSchedulerManagement';
import { postgresManagementSQL } from './jobPostgresManagement';
import { sqlServerManagementSQL } from './jobSqlServerManagement';
import { damengManagementSQL } from './jobDamengManagement';
import { distributedManagementSQL } from './jobDistributedManagement';
import { jobHistorySQL } from './jobHistoryQueries';
import { requireCreate } from './jobManagementSQL';
import { eventManagementPlan } from './jobEventManagement';
import { jobStatusSQL } from './jobStatusQueries';

export const createJobSources = (target: Pick<JobTarget, 'dialect' | 'database'>) => (
  buildDatabaseJobListQueries(target.dialect, target.database).map(g => g.kind).filter(kind => supportedJobOperations(kind).includes('create'))
);

export const buildJobManagementPlan = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): JobSQLPlan => {
  if (!supportedJobOperations(target.kind).includes(operation)) throw new Error('database_jobs.manage.no_native_operation');
  if (operation === 'create') {
    requireCreate(input.name);
    if (target.kind !== 'kingbase-scheduler' && !input.action.trim()) throw new Error('database_jobs.manage.action_required');
    if (target.kind === 'pg-cron' && !input.schedule.trim()) throw new Error('database_jobs.manage.schedule_required');
  }
  else if (!target.name) throw new Error('database_jobs.manage.invalid_identity');
  if (target.kind === 'mysql-event') return eventManagementPlan(target, operation, snapshot, input);
  const kinds = buildDatabaseJobListQueries(target.dialect, target.database).map(g => g.kind);
  if (!kinds.includes(target.kind)) throw new Error('database_jobs.manage.no_native_operation');
  let sql = '';
  if (operation === 'history') sql = jobHistorySQL(target, snapshot);
  else if (operation === 'status') sql = jobStatusSQL(target, snapshot);
  else if (['oracle-scheduler', 'dbms-job', 'kingbase-scheduler', 'oceanbase-oracle'].includes(target.kind)) sql = schedulerManagementSQL(target, operation, snapshot, input);
  else if (['pg-cron', 'pgagent', 'opengauss-job', 'gaussdb-job'].includes(target.kind)) sql = postgresManagementSQL(target, operation, snapshot, input);
  else if (target.kind === 'sqlserver-agent') sql = sqlServerManagementSQL(target, operation, snapshot, input);
  else if (target.kind === 'dm-agent') sql = damengManagementSQL(target, operation, snapshot, input);
  else sql = distributedManagementSQL(target, operation, snapshot, input);
  if (!sql.trim()) throw new Error('database_jobs.manage.no_native_operation');
  return { sql, readOnly: operation === 'history' || operation === 'status', warning: warningFor(target, operation) };
};

const warningFor = (target: JobTarget, operation: JobOperation): string | undefined => {
  if (operation === 'history' || operation === 'status') return undefined;
  if (target.kind === 'starrocks-task') return 'database_jobs.manage.starrocks_scope';
  if (target.kind === 'dm-agent') return 'database_jobs.manage.dm_commits';
  if (target.kind === 'pgagent') return 'database_jobs.manage.pgagent_scope';
  if (target.kind === 'oceanbase-mysql') return 'database_jobs.manage.ob_mysql_scope';
  if (target.kind === 'oceanbase-oracle') return 'database_jobs.manage.ob_oracle_scope';
  if (operation === 'create' && ['opengauss-job', 'gaussdb-job', 'doris-job'].includes(target.kind)) return 'database_jobs.manage.create_active';
  if (target.kind === 'sqlserver-agent' && operation === 'edit') return 'database_jobs.manage.shared_schedule';
  return 'database_jobs.manage.native_sql';
};
