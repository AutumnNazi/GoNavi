import type { DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { isJobID, jobLiteral, type DatabaseJobQueryGroup } from './jobQueryTypes';

// Compare encoded strings to avoid dependence on NO_BACKSLASH_ESCAPES or interpolated identifiers.
const hexPredicate = (column: string, value: string): string => {
  const hex = Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `HEX(${column}) = '${hex}'`;
};

export const oceanBaseJobListQueries = (oracle: boolean, schema: string): DatabaseJobQueryGroup[] => [{
  kind: oracle ? 'oceanbase-oracle' : 'oceanbase-mysql',
  queries: [`SELECT OWNER AS schema_name, JOB_NAME AS job_name, ENABLED AS enabled, STATE AS state, NEXT_RUN_DATE AS next_run_at FROM ${oracle ? 'SYS.DBA_SCHEDULER_JOBS' : 'oceanbase.DBA_SCHEDULER_JOBS'}${oracle ? ` WHERE OWNER = ${schema ? jobLiteral(schema) : 'USER'}` : ''} ORDER BY OWNER, JOB_NAME`],
}];

export const oceanBaseJobDefinitionQueries = (oracle: boolean, owner: string, name: string): string[] => {
  // MySQL catalogs are tenant-wide; use the returned owner, never the selected database as owner.
  if (!oracle && !owner) return [];
  const view = oracle ? 'SYS.DBA_SCHEDULER_JOBS' : 'oceanbase.DBA_SCHEDULER_JOBS';
  const where = oracle
    ? `OWNER = ${owner ? jobLiteral(owner) : 'USER'} AND JOB_NAME = ${jobLiteral(name)}`
    : `${hexPredicate('OWNER', owner)} AND ${hexPredicate('JOB_NAME', name)}`;
  const common = 'OWNER AS schema_name, JOB_NAME AS job_name, ENABLED AS enabled, STATE AS state, NEXT_RUN_DATE AS next_run_at, LAST_START_DATE AS last_start_date, PROGRAM_NAME AS program_name';
  return [
    `SELECT ${common}, JOB_TYPE AS job_type, JOB_ACTION AS action, START_DATE AS start_date, REPEAT_INTERVAL AS repeat_interval, END_DATE AS end_date, COMMENTS AS comments FROM ${view} WHERE ${where}`,
    // Older OceanBase releases expose only these columns. The definition loader marks it partial.
    `SELECT ${common} FROM ${view} WHERE ${where}`,
  ];
};

export const distributedJobListQueries = (dialect: string, database: string): DatabaseJobQueryGroup[] => {
  if (dialect === 'doris') return [{
    kind: 'doris-job',
    // JOBS(insert) is a cluster-wide catalog; do not invent a nonexistent database column.
    queries: ["SELECT CAST(Id AS STRING) AS job_name, Name AS job_label, Status AS state FROM jobs('type'='insert') ORDER BY Id"],
  }];
  if (dialect === 'starrocks' && database) return [{
    kind: 'starrocks-task',
    queries: [`SELECT TASK_NAME AS job_name FROM information_schema.tasks WHERE ${hexPredicate('`DATABASE`', database)} ORDER BY TASK_NAME`],
  }];
  return [];
};

export const distributedJobDefinitionQueries = (kind: DatabaseJobKind, database: string, name: string): string[] => {
  if (kind === 'doris-job' && isJobID(name)) return [
    `SELECT CAST(Id AS STRING) AS job_name, Id AS job_id, Name AS job_label, Definer AS owner, ExecuteType AS job_type, RecurringStrategy AS repeat_interval, Status AS state, ExecuteSql AS action, CreateTime AS create_time, SucceedTaskCount AS run_count, FailedTaskCount AS failure_count, CanceledTaskCount, Comment AS comments FROM jobs('type'='insert') WHERE Id = ${name}`,
  ];
  if (kind === 'starrocks-task' && database) return [
    `SELECT TASK_NAME AS job_name, CREATE_TIME AS create_time, SCHEDULE AS repeat_interval, \`DATABASE\` AS database_name, DEFINITION AS action, EXPIRE_TIME FROM information_schema.tasks WHERE ${hexPredicate('`DATABASE`', database)} AND ${hexPredicate('TASK_NAME', name)}`,
  ];
  return [];
};
