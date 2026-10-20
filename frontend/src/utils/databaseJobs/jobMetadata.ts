import type {
  DatabaseJobEntry, DatabaseJobKind, DatabaseJobQueryExecutor, DatabaseJobRow,
} from '../../typeDefs/databaseJobTypes';
import { isSchemaScopedJobKind } from '../../typeDefs/databaseJobTypes';
import type { DatabaseJobQueryGroup } from './jobQueryTypes';

export const readDatabaseJobValue = (row: DatabaseJobRow, key: string): unknown => {
  const matched = Object.keys(row).find((name) => name.toLowerCase() === key.toLowerCase());
  return matched ? row[matched] : undefined;
};

export const readDatabaseJobText = (row: DatabaseJobRow, key: string): string => {
  const value = readDatabaseJobValue(row, key);
  return value === undefined || value === null ? '' : String(value);
};

export const runDatabaseJobQueries = async (
  queries: string[],
  execute: DatabaseJobQueryExecutor,
  failureMessage: string,
): Promise<{ success: boolean; rows: DatabaseJobRow[]; message?: string; queryIndex?: number }> => {
  let message = failureMessage;
  for (const [queryIndex, sql] of queries.entries()) {
    try {
      const result = await execute(sql);
      if (result.success && Array.isArray(result.data)) {
        return {
          success: true,
          rows: result.data.filter((row): row is DatabaseJobRow => (
            row !== null && typeof row === 'object' && !Array.isArray(row)
          )),
          ...(queryIndex > 0 ? { queryIndex } : {}),
        };
      }
      message = result.message || failureMessage;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error || failureMessage);
    }
  }
  return { success: false, rows: [], message };
};

export const normalizeDatabaseJobs = (
  rows: DatabaseJobRow[],
  kind: DatabaseJobKind,
  requestedSchema: string,
): DatabaseJobEntry[] => {
  const seen = new Set<string>();
  return rows.flatMap((row): DatabaseJobEntry[] => {
    const schemaName = readDatabaseJobText(row, 'schema_name').trim();
    const jobName = readDatabaseJobText(row, 'job_name').trim();
    if (!jobName) return [];
    if (isSchemaScopedJobKind(kind) && (!schemaName || (requestedSchema && requestedSchema !== schemaName))) return [];
    if (kind === 'dbms-job' && !/^\d+$/.test(jobName)) return [];
    const identity = JSON.stringify([schemaName, jobName]);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const broken = readDatabaseJobText(row, 'broken').trim().toUpperCase();
    return [{
      schemaName, jobName, jobKind: kind,
      ...(readDatabaseJobText(row, 'job_label') ? { jobLabel: readDatabaseJobText(row, 'job_label') } : {}),
      enabled: kind === 'dbms-job' ? (broken === 'Y' ? 'FALSE' : broken === 'N' ? 'TRUE' : '') : readDatabaseJobText(row, 'enabled'),
      state: kind === 'dbms-job' ? broken : readDatabaseJobText(row, 'state'),
      nextRunAt: readDatabaseJobText(row, 'next_run_at'),
    }];
  });
};

export const runDatabaseJobGroup = async (
  group: DatabaseJobQueryGroup, execute: DatabaseJobQueryExecutor, failureMessage: string,
): Promise<{ success: boolean; rows: DatabaseJobRow[]; message?: string; unavailable?: boolean }> => {
  if (group.probeQueries) {
    const probe = await runDatabaseJobQueries(group.probeQueries, execute, failureMessage);
    if (!probe.success) return probe;
    const available = probe.rows[0] && readDatabaseJobText(probe.rows[0], 'available').toLowerCase();
    if (['false', 'f', '0'].includes(available || '')) return { success: false, rows: [], unavailable: true };
    if (!['true', 't', '1'].includes(available || '')) return { success: false, rows: [], message: failureMessage };
  }
  return runDatabaseJobQueries(group.queries, execute, failureMessage);
};
