import { DBQuery } from '../../../wailsjs/go/app/App';
import { t } from '../../i18n';
import type { SavedConnection } from '../../types';
import type { DatabaseJobEntry } from '../../typeDefs/databaseJobTypes';
import { buildDatabaseJobListQueries } from '../../utils/databaseJobs/jobQueries';
import { normalizeDatabaseJobs, runDatabaseJobGroup } from '../../utils/databaseJobs/jobMetadata';
import { resolveDatabaseJobDialect } from '../../utils/databaseJobs/jobCapabilities';
import { buildSidebarRuntimeConfig } from './sidebarMetadataBasics';

export type DatabaseJobsResult = {
  jobs: DatabaseJobEntry[];
  supported: boolean;
  failureMessage?: string;
};

export const supportsDatabaseJobs = (conn: SavedConnection | undefined): boolean => (
  resolveDatabaseJobDialect(conn?.config) !== null
);

export const loadDatabaseJobs = async (
  conn: SavedConnection,
  dbName: string,
): Promise<DatabaseJobsResult> => {
  const schemaName = String(dbName || '').trim();
  const groups = buildDatabaseJobListQueries(resolveDatabaseJobDialect(conn.config) || '', schemaName);
  if (groups.length === 0) return { jobs: [], supported: false };
  const config = buildSidebarRuntimeConfig(conn, dbName);
  const results = await Promise.all(groups.map(async (group) => ({
    kind: group.kind,
    result: await runDatabaseJobGroup(group, (sql) => DBQuery(config, dbName, sql), t('database_jobs.error.query_failed')),
  })));
  const jobs = results.flatMap(({ kind, result }) => normalizeDatabaseJobs(result.rows, kind, schemaName));
  const failures = results.filter(({ result }) => !result.success && !result.unavailable).map(({ kind, result }) => (
    `${t(`database_jobs.source.${kind}`)}: ${result.message}`
  ));
  return {
    jobs: jobs.sort((a, b) => (a.jobLabel || a.jobName).localeCompare(b.jobLabel || b.jobName) || a.jobKind.localeCompare(b.jobKind) || a.jobName.localeCompare(b.jobName)),
    supported: results.some(({ result }) => result.success),
    ...(failures.length ? { failureMessage: failures.join('; ') } : {}),
  };
};
