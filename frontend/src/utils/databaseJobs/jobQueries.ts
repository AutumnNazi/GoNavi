import type { DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { extendedJobListQueries, extendedJobDefinitionQueries } from './jobProviderQueries';
import type { DatabaseJobQueryGroup } from './jobQueryTypes';

export type { DatabaseJobQueryGroup } from './jobQueryTypes';

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const ownerPredicate = (column: string, schemaName: string): string => (
  `${column} = ${schemaName ? literal(schemaName) : 'USER'}`
);

// DM8 exposes SYSJOB system tables and owner-only USER_*_VIEW catalogs,
// not Oracle-style ALL_* views. Both paths retain the requested owner scope.
const DAMENG_JOB_CATALOGS = [
  { jobs: 'SYSJOB.SYSJOBS', steps: 'SYSJOB.SYSJOBSTEPS', schedules: 'SYSJOB.SYSJOBSCHEDULES' },
  { jobs: 'SYSJOB.USER_JOBS_VIEW', steps: 'SYSJOB.USER_JOBSTEPS_VIEW', schedules: 'SYSJOB.USER_JOBSCHEDULES_VIEW' },
] as const;

// SYSJOB owns both native job tables and the optional DBMS_JOB compatibility views.
const DAMENG_LEGACY_JOB_CATALOGS = ['SYSJOB.DBA_JOBS', 'SYSJOB.USER_JOBS'] as const;

const damengJobCatalogProbe = (names: readonly string[]): string => (
  `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS available FROM SYS.ALL_OBJECTS WHERE OWNER = 'SYSJOB' AND OBJECT_NAME IN (${names.map(literal).join(', ')}) AND OBJECT_TYPE IN ('TABLE', 'VIEW')`
);

// ALL_* views honour database grants; never retry an unscoped USER_* query for
// another owner. Preserve catalog case for quoted schema and job names.
export const buildDatabaseJobListQueries = (
  dialect: string,
  schemaName: string,
): DatabaseJobQueryGroup[] => {
  if (dialect !== 'oracle' && dialect !== 'dm') return extendedJobListQueries(dialect, schemaName);
  const schema = schemaName.trim();
  const legacyViews = dialect === 'dm' ? DAMENG_LEGACY_JOB_CATALOGS : ['ALL_JOBS'];
  const legacy: DatabaseJobQueryGroup = {
    kind: 'dbms-job',
    queries: legacyViews.map((view) => `SELECT SCHEMA_USER AS schema_name, JOB AS job_name, BROKEN AS broken, NEXT_DATE AS next_run_at FROM ${view} WHERE ${ownerPredicate('SCHEMA_USER', schema)} ORDER BY JOB`),
    ...(dialect === 'dm' ? { probeQueries: [damengJobCatalogProbe(['DBA_JOBS', 'USER_JOBS'])] } : {}),
  };
  if (dialect === 'oracle') {
    return [{
      kind: 'oracle-scheduler',
      queries: [`SELECT OWNER AS schema_name, JOB_NAME AS job_name, ENABLED AS enabled, STATE AS state, NEXT_RUN_DATE AS next_run_at FROM ALL_SCHEDULER_JOBS WHERE ${ownerPredicate('OWNER', schema)} ORDER BY JOB_NAME`],
    }, legacy];
  }
  return [{
    kind: 'dm-agent',
    probeQueries: [damengJobCatalogProbe(['SYSJOBS', 'USER_JOBS_VIEW'])],
    queries: DAMENG_JOB_CATALOGS.map(({ jobs }) => `SELECT USERNAME AS schema_name, NAME AS job_name, ENABLE AS enabled, VALID AS state FROM ${jobs} WHERE ${ownerPredicate('USERNAME', schema)} ORDER BY NAME`),
  }, legacy];
};

export const buildDatabaseJobDefinitionQueries = (
  dialect: string,
  kind: DatabaseJobKind,
  schemaName: string,
  jobName: string,
  database = '',
): string[] => {
  if (!jobName.trim()) return [];
  if (dialect !== 'oracle' && dialect !== 'dm') return extendedJobDefinitionQueries(dialect, kind, schemaName, jobName, database);
  const schema = schemaName.trim();
  if (kind === 'oracle-scheduler' && dialect === 'oracle') {
    return [`SELECT OWNER AS schema_name, JOB_NAME AS job_name, JOB_TYPE AS job_type, JOB_ACTION AS action, PROGRAM_OWNER AS program_owner, PROGRAM_NAME AS program_name, NUMBER_OF_ARGUMENTS AS number_of_arguments, SCHEDULE_OWNER AS schedule_owner, SCHEDULE_NAME AS schedule_name, REPEAT_INTERVAL AS repeat_interval, START_DATE AS start_date, END_DATE AS end_date, ENABLED AS enabled, STATE AS state, NEXT_RUN_DATE AS next_run_at, LAST_START_DATE AS last_start_date, LAST_RUN_DURATION AS last_run_duration, RUN_COUNT AS run_count, FAILURE_COUNT AS failure_count, COMMENTS AS comments FROM ALL_SCHEDULER_JOBS WHERE ${ownerPredicate('OWNER', schema)} AND JOB_NAME = ${literal(jobName)}`];
  }
  if (kind === 'dbms-job' && /^\d+$/.test(jobName)) {
    const views = dialect === 'dm' ? DAMENG_LEGACY_JOB_CATALOGS : ['ALL_JOBS'];
    return views.map((view) => `SELECT SCHEMA_USER AS schema_name, JOB AS job_name, WHAT AS action, INTERVAL AS repeat_interval, BROKEN AS broken, NEXT_DATE AS next_run_at, LAST_DATE AS last_start_date, FAILURES AS failure_count FROM ${view} WHERE ${ownerPredicate('SCHEMA_USER', schema)} AND JOB = ${jobName}`);
  }
  if (kind === 'dm-agent' && dialect === 'dm') {
    return DAMENG_JOB_CATALOGS.map(({ jobs }) => `SELECT USERNAME AS schema_name, NAME AS job_name, ID AS job_id, ENABLE AS enabled, VALID AS state, CREATETIME AS create_time, DESCRIBE AS comments FROM ${jobs} WHERE ${ownerPredicate('USERNAME', schema)} AND NAME = ${literal(jobName)}`);
  }
  return [];
};

export const buildDamengJobChildQueries = (
  schemaName: string,
  jobName: string,
): { steps: string[]; schedules: string[] } => {
  const catalogs = DAMENG_JOB_CATALOGS.map((catalog) => ({
    ...catalog,
    scope: `SELECT ID FROM ${catalog.jobs} WHERE ${ownerPredicate('USERNAME', schemaName.trim())} AND NAME = ${literal(jobName)}`,
  }));
  return {
    steps: catalogs.map(({ steps, scope }) => `SELECT ID AS step_id, SEQNO AS step_sequence, NAME AS step_name, TYPE AS step_type, COMMAND AS action, DBNAME AS database_name, SUCC_ACTION AS success_action, FAIL_ACTION AS failure_action, RETRY_ATTEMPTS AS retry_attempts, RETRY_INTERVAL AS retry_interval FROM ${steps} WHERE JOBID IN (${scope}) ORDER BY SEQNO, ID`),
    schedules: catalogs.map(({ schedules, scope }) => `SELECT * FROM ${schedules} WHERE JOBID IN (${scope}) ORDER BY ID`),
  };
};

export const buildOracleJobReferenceQueries = (
  reference: 'program' | 'schedule',
  owner: string,
  name: string,
): string[] => {
  if (!owner || !name) return [];
  return reference === 'program'
    ? [`SELECT OWNER AS schema_name, PROGRAM_NAME AS program_name, PROGRAM_TYPE AS job_type, PROGRAM_ACTION AS action, NUMBER_OF_ARGUMENTS AS number_of_arguments, ENABLED AS enabled, COMMENTS AS comments FROM ALL_SCHEDULER_PROGRAMS WHERE OWNER = ${literal(owner)} AND PROGRAM_NAME = ${literal(name)}`]
    : [`SELECT OWNER AS schema_name, SCHEDULE_NAME AS schedule_name, REPEAT_INTERVAL AS repeat_interval, START_DATE AS start_date, END_DATE AS end_date, COMMENTS AS comments FROM ALL_SCHEDULER_SCHEDULES WHERE OWNER = ${literal(owner)} AND SCHEDULE_NAME = ${literal(name)}`];
};
