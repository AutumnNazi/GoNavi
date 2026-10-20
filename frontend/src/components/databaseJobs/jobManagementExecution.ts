import type { SavedConnection } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';
import { resolveConnectionProtectionConfig } from '../../utils/connectionReadOnly';
import type { JobOperation } from '../../utils/databaseJobs/jobManagementTypes';

export const isJobMutationRestricted = (connection: SavedConnection | undefined): boolean => {
  if (!connection) return true;
  const protections = resolveConnectionProtectionConfig(connection.config);
  return Boolean(connection.config.readOnly === true || protections.restrictStructureEdit || protections.restrictDataEdit || protections.restrictScriptExecution || protections.restrictDataImport);
};

export type JobExecutionDependencies = {
  getConnection: () => SavedConnection | undefined;
  confirm: (connection: SavedConnection) => Promise<boolean>;
  execute: (connection: SavedConnection, sql: string) => Promise<DatabaseJobQueryResult>;
  validateFresh?: () => Promise<void>;
};

/** Re-resolve protections after async confirmation; do not retry a dispatched mutation. */
export const executeJobManagement = async (
  operation: JobOperation, sql: string, dependencies: JobExecutionDependencies,
): Promise<DatabaseJobQueryResult | null> => {
  if (!sql.trim() || /__GONAVI_[A-Z_]+__/.test(sql)) throw new Error('database_jobs.manage.fill_placeholders');
  const connection = dependencies.getConnection();
  if (!connection) throw new Error('database_jobs.manage.connection_missing');
  const readOnly = operation === 'history' || operation === 'status';
  if (!readOnly && isJobMutationRestricted(connection)) throw new Error('database_jobs.manage.protected');
  const identity = JSON.stringify(connection.config);
  if (!readOnly && !await dependencies.confirm(connection)) return null;
  if (!readOnly) await dependencies.validateFresh?.();
  const current = dependencies.getConnection();
  if (!current || JSON.stringify(current.config) !== identity) throw new Error('database_jobs.manage.connection_changed');
  if (!readOnly && isJobMutationRestricted(current)) throw new Error('database_jobs.manage.protected');
  return dependencies.execute(current, sql);
};
