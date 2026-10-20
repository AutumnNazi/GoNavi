import { DBQuery } from '../../../wailsjs/go/app/App';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobQueryExecutor, DatabaseJobRow } from '../../typeDefs/databaseJobTypes';
import {
  buildDatabaseJobDefinitionQueries, buildDamengJobChildQueries, buildOracleJobReferenceQueries,
} from '../../utils/databaseJobs/jobQueries';
import { readDatabaseJobText, runDatabaseJobQueries } from '../../utils/databaseJobs/jobMetadata';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import { resolveDatabaseJobDialect } from '../../utils/databaseJobs/jobCapabilities';
import { extendedJobChildQueries } from '../../utils/databaseJobs/jobProviderQueries';
import { additionalJobReferences } from '../../utils/databaseJobs/jobReferenceQueries';
import { formatDatabaseJobDefinition, type JobDefinitionTranslate } from './jobDefinition';

const loadJobChildren = async (
  dialect: string,
  tab: TabData,
  job: DatabaseJobRow,
  execute: DatabaseJobQueryExecutor,
  translate: JobDefinitionTranslate,
) => {
  const empty = { steps: [] as DatabaseJobRow[], schedules: [] as DatabaseJobRow[], program: undefined as DatabaseJobRow | undefined, failures: [] as string[] };
  const failureMessage = translate('database_jobs.error.query_failed');
  if (tab.jobKind) {
    const queries = extendedJobChildQueries(tab.jobKind, tab.jobName || '');
    for (const section of ['steps', 'schedules'] as const) {
      if (!queries[section]) continue;
      const result = await runDatabaseJobQueries(queries[section], execute, failureMessage);
      empty[section] = result.rows;
      if (!result.success) empty.failures.push(result.message || failureMessage);
      else if (section === 'steps' && (tab.jobKind === 'gaussdb-job' || tab.jobKind === 'opengauss-job') && !result.rows.length) empty.failures.push(translate('database_jobs.warning.action_unavailable'));
    }
    for (const reference of additionalJobReferences(tab.jobKind, job)) {
      const result = await runDatabaseJobQueries(reference.queries, execute, failureMessage);
      if (!result.success || !result.rows.length) empty.failures.push(result.message || translate('database_jobs.error.reference_not_found'));
      else if (reference.kind === 'program') empty.program = result.rows[0];
      else empty.schedules = result.rows;
    }
  }
  if (dialect === 'dm' && tab.jobKind === 'dm-agent') {
    const queries = buildDamengJobChildQueries(tab.schemaName || tab.dbName || '', tab.jobName || '');
    const [steps, schedules] = await Promise.all([
      runDatabaseJobQueries(queries.steps, execute, failureMessage),
      runDatabaseJobQueries(queries.schedules, execute, failureMessage),
    ]);
    return {
      ...empty, steps: steps.rows, schedules: schedules.rows,
      failures: [steps, schedules].filter((result) => !result.success).map((result) => result.message || failureMessage),
    };
  }
  if (dialect === 'oracle' && tab.jobKind === 'oracle-scheduler') {
    const references = (['program', 'schedule'] as const).map((kind) => ({
      kind,
      queries: buildOracleJobReferenceQueries(kind, readDatabaseJobText(job, `${kind}_owner`), readDatabaseJobText(job, `${kind}_name`)),
    })).filter(({ queries }) => queries.length > 0);
    for (const reference of references) {
      const result = await runDatabaseJobQueries(reference.queries, execute, failureMessage);
      if (!result.success || result.rows.length === 0) {
        empty.failures.push(result.message || translate('database_jobs.error.reference_not_found'));
      } else if (reference.kind === 'program') {
        empty.program = result.rows[0];
      } else {
        empty.schedules = result.rows;
      }
    }
  }
  return empty;
};

export const loadDatabaseJobDefinition = async (
  conn: SavedConnection,
  tab: TabData,
  translate: JobDefinitionTranslate,
): Promise<{ success: boolean; definition?: string; error?: string }> => {
  const dialect = resolveDatabaseJobDialect(conn.config);
  const kind = tab.jobKind;
  const jobName = String(tab.jobName || '').trim();
  if (!jobName || !kind) return { success: false, error: translate('database_jobs.error.identity_missing') };
  const queries = buildDatabaseJobDefinitionQueries(dialect || '', kind, tab.schemaName || tab.dbName || '', jobName, tab.dbName || '');
  if (queries.length === 0) return { success: false, error: translate('database_jobs.error.unsupported') };
  const config = buildRpcConnectionConfig(conn.config);
  const execute: DatabaseJobQueryExecutor = (sql) => DBQuery(config, tab.dbName || '', sql);
  const result = await runDatabaseJobQueries(queries, execute, translate('database_jobs.error.query_failed'));
  if (!result.success) return { success: false, error: result.message };
  if (result.rows.length === 0) return { success: false, error: translate('database_jobs.error.not_found') };
  const job = result.rows[0];
  const children = await loadJobChildren(dialect || '', tab, job, execute, translate);
  if ((kind === 'oceanbase-oracle' || kind === 'oceanbase-mysql' || kind === 'kingbase-scheduler')
      && !readDatabaseJobText(job, 'action') && !(children.program && readDatabaseJobText(children.program, 'action'))) children.failures.push(translate('database_jobs.warning.action_unavailable'));
  return {
    success: true,
    definition: formatDatabaseJobDefinition(kind, job, children.steps, children.schedules, children.program, translate),
    ...(children.failures.length ? { error: children.failures.join('; ') } : {}),
  };
};
