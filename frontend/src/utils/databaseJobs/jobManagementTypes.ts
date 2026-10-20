import type { DatabaseJobKind, DatabaseJobRow } from '../../typeDefs/databaseJobTypes';
import type { DatabaseJobDialect } from './jobCapabilities';
import type { ConnectionConfig } from '../../types';
import { resolveDatabaseJobDialect } from './jobCapabilities';

export const JOB_OPERATIONS = ['edit', 'enable', 'disable', 'run', 'stop', 'drop', 'history', 'status'] as const;
export type JobOperation = typeof JOB_OPERATIONS[number] | 'create';
export type ManagedJobKind = DatabaseJobKind | 'mysql-event';
export type JobTarget = { dialect: DatabaseJobDialect | 'mysql' | 'mariadb'; kind: ManagedJobKind; database: string; owner: string; name: string };
export const resolveJobManagementDialect = (config?: ConnectionConfig): JobTarget['dialect'] | null => {
  const native = resolveDatabaseJobDialect(config);
  if (native) return native;
  const engine = String(config?.type === 'custom' ? config.driver : config?.type).toLowerCase();
  return engine === 'mysql' || engine === 'mariadb' ? engine : null;
};
export type JobSnapshot = {
  job: DatabaseJobRow; steps: DatabaseJobRow[]; schedules: DatabaseJobRow[]; exceptions?: DatabaseJobRow[];
  // Status reads must keep the accessible catalog/version selected during metadata loading.
  definitionQueryIndex?: number;
};
export type JobCreateInput = { name: string; action: string; schedule: string; program: string; scheduleName: string; jobType: string };
export type JobSQLPlan = { sql: string; readOnly: boolean; warning?: string };
export const emptyJobSnapshot = (): JobSnapshot => ({ job: {}, steps: [], schedules: [] });

/** Engine limitations, not a promise that the current login has permission. */
const nativeOperations: Record<ManagedJobKind, readonly JobOperation[]> = {
  'oracle-scheduler': ['create', ...JOB_OPERATIONS],
  'dbms-job': ['create', 'edit', 'enable', 'disable', 'run', 'drop', 'status'],
  'dm-agent': ['create', ...JOB_OPERATIONS],
  'sqlserver-agent': ['create', ...JOB_OPERATIONS],
  'pg-cron': ['create', 'edit', 'enable', 'disable', 'drop', 'history', 'status'],
  pgagent: ['create', 'edit', 'enable', 'disable', 'run', 'drop', 'history', 'status'],
  'kingbase-scheduler': ['create', 'enable', 'disable', 'run', 'drop', 'history', 'status'],
  'opengauss-job': ['create', 'edit', 'enable', 'disable', 'drop', 'status'],
  'gaussdb-job': ['create', 'edit', 'enable', 'disable', 'drop', 'status'],
  'oceanbase-oracle': ['create', 'edit', 'enable', 'disable', 'run', 'stop', 'drop', 'history', 'status'],
  // The public MySQL package exposes only enable, disable and set_attribute.
  'oceanbase-mysql': ['edit', 'enable', 'disable', 'status'],
  // INSERT jobs do not support Streaming Job's ALTER JOB syntax.
  'doris-job': ['create', 'enable', 'disable', 'drop', 'history', 'status'],
  'starrocks-task': ['create', 'edit', 'enable', 'disable', 'drop', 'history', 'status'],
  'mysql-event': ['create', 'edit', 'enable', 'disable', 'drop', 'status'],
};
export const supportedJobOperations = (kind: ManagedJobKind): readonly JobOperation[] => nativeOperations[kind];
export const jobOperationUnavailableReason = (kind: ManagedJobKind, operation: JobOperation): string => {
  if (supportedJobOperations(kind).includes(operation)) return '';
  if (kind === 'kingbase-scheduler' && operation === 'edit') return 'database_jobs.manage.no_kingbase_alter';
  if (kind === 'doris-job' && operation === 'edit') return 'database_jobs.manage.no_doris_alter';
  if (kind === 'pg-cron' && operation === 'run') return 'database_jobs.manage.no_cron_run';
  return 'database_jobs.manage.no_native_operation';
};
