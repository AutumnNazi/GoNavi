import { describe, expect, it } from 'vitest';
import { resolveDatabaseJobDialect, usesSchemaScopedDatabaseJobs } from './jobCapabilities';
import { buildDatabaseJobListQueries, buildDatabaseJobDefinitionQueries } from './jobQueries';
import { extendedJobChildQueries } from './jobProviderQueries';
import { normalizeDatabaseJobs, runDatabaseJobGroup } from './jobMetadata';
import { DATABASE_JOB_KINDS, type DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { toSnapshotTab } from '../workbenchSessionSnapshot';
import { normalizeSidebarLocateObjectRequestFromTab, resolveSidebarLocateTarget } from '../sidebarLocate';

describe('explicit scheduler engine capabilities', () => {
  it.each([
    ['sqlserver', 'sqlserver'], ['postgres', 'postgres'], ['postgresql', 'postgres'], ['pgx', 'postgres'],
    ['kingbase', 'kingbase'], ['kingbase8', 'kingbase'], ['opengauss', 'opengauss'], ['open-gauss', 'opengauss'],
    ['gaussdb', 'gaussdb'], ['diros', 'doris'], ['doris', 'doris'], ['starrocks', 'starrocks'], ['timescaledb', 'postgres'],
  ])('maps %s without using a borrowed dialect', (type, dialect) => {
    expect(resolveDatabaseJobDialect({ type })).toBe(dialect);
    expect(resolveDatabaseJobDialect({ type: 'custom', driver: type })).toBe(dialect);
  });
  it.each(['mysql', 'mariadb', 'tidb', 'cockroachdb', 'sqlite', 'redis', 'db2', 'snowflake', 'not-oracle'])('does not claim job adapters/drivers for %s', (type) => {
    expect(resolveDatabaseJobDialect({ type })).toBeNull();
    expect(resolveDatabaseJobDialect({ type: 'custom', driver: type })).toBeNull();
  });
  it('separates both OceanBase protocols and schema scope', () => {
    expect(resolveDatabaseJobDialect({ type: 'oceanbase', oceanBaseProtocol: 'mysql' })).toBe('oceanbase-mysql');
    expect(usesSchemaScopedDatabaseJobs({ type: 'oceanbase', oceanBaseProtocol: 'oracle' })).toBe(true);
    expect(usesSchemaScopedDatabaseJobs({ type: 'oceanbase', oceanBaseProtocol: 'mysql' })).toBe(false);
    expect(usesSchemaScopedDatabaseJobs({ type: 'postgres' })).toBe(false);
  });
});

describe('documented scheduler catalog queries', () => {
  it('queries SQL Server instance jobs only under msdb and validates GUIDs', () => {
    expect(buildDatabaseJobListQueries('sqlserver', 'app')).toEqual([]);
    expect(buildDatabaseJobListQueries('sqlserver', 'msdb')[0].queries[0]).toContain('msdb.dbo.sysjobs');
    const id = '12345678-1234-1234-1234-123456789abc';
    expect(buildDatabaseJobDefinitionQueries('sqlserver', 'sqlserver-agent', '', id, 'app')).toEqual([]);
    expect(buildDatabaseJobDefinitionQueries('sqlserver', 'sqlserver-agent', '', id, 'msdb')[0]).toContain(id);
    expect(buildDatabaseJobDefinitionQueries('sqlserver', 'sqlserver-agent', '', "x';DROP TABLE x", 'msdb')).toEqual([]);
    expect(extendedJobChildQueries('sqlserver-agent', id).schedules?.[0]).toContain('msdb.dbo.sysschedules');
    expect(extendedJobChildQueries('sqlserver-agent', 'bad')).toEqual({});
  });
  it('keeps native PG catalog jobs in the installation database and omits pgAgent connection secrets', () => {
    const groups = buildDatabaseJobListQueries('postgres', 'app');
    expect(groups.map((g) => g.kind)).toEqual(['pg-cron', 'pgagent']);
    expect(groups.every((g) => g.probeQueries?.[0].includes('pg_catalog.pg_class'))).toBe(true);
    expect(groups.flatMap((g) => g.queries).join(' ')).not.toContain("database = 'app'");
    const children = extendedJobChildQueries('pgagent', '42');
    expect(children.steps?.[0]).toContain('ORDER BY jstname, jstid');
    expect(children.steps?.[0]).not.toMatch(/jstconnstr|SELECT \*/);
    expect(children.schedules?.[0]).toContain('pgagent.pga_exception');
    expect(buildDatabaseJobDefinitionQueries('postgres', 'pg-cron', '', '2', 'postgres')).toHaveLength(3);
  });
  it('does not filter Kingbase jobs using its always-null owner', () => {
    const queries = buildDatabaseJobListQueries('kingbase', 'app')[0].queries;
    expect(queries[0]).toContain('all_scheduler_jobs');
    expect(queries[0]).not.toMatch(/WHERE|OWNER/);
    expect(buildDatabaseJobDefinitionQueries('kingbase', 'kingbase-scheduler', '', "O'Brien", 'app')[0]).toContain("job_name = 'O''Brien'");
  });
  it.each(['opengauss', 'gaussdb'])('scopes %s to current database and separates action metadata', (dialect) => {
    const kind = `${dialect}-job` as DatabaseJobKind;
    expect(buildDatabaseJobListQueries(dialect, 'app')[0].queries[0]).toContain('dbname = current_database()');
    expect(buildDatabaseJobDefinitionQueries(dialect, kind, '', '3', 'app')[0]).toContain('job_id = 3');
    expect(extendedJobChildQueries(kind, '3').steps?.[0]).toContain('pg_catalog.pg_job_proc');
    expect(buildDatabaseJobDefinitionQueries(dialect, kind, '', '3 OR 1=1', 'app')).toEqual([]);
  });
  it('does not reuse Oracle SYS views for OceanBase MySQL tenants', () => {
    const oracle = buildDatabaseJobListQueries('oceanbase-oracle', "MiX'ed")[0];
    expect(oracle.queries[0]).toContain("SYS.DBA_SCHEDULER_JOBS WHERE OWNER = 'MiX''ed'");
    const mysql = buildDatabaseJobListQueries('oceanbase-mysql', 'app')[0];
    expect(mysql.queries[0]).toContain('oceanbase.DBA_SCHEDULER_JOBS');
    expect(mysql.queries[0]).not.toContain('WHERE OWNER');
    const sql = buildDatabaseJobDefinitionQueries('oceanbase-mysql', 'oceanbase-mysql', "u'\\", "job';DROP x", 'app')[0];
    expect(sql).toContain('HEX(OWNER)');
    expect(sql).toContain('HEX(JOB_NAME)');
    expect(sql).not.toContain('DROP x');
  });
  it('uses Doris Id/Name fields and StarRocks database-qualified task metadata', () => {
    expect(buildDatabaseJobListQueries('doris', 'db')[0].queries[0]).toContain("jobs('type'='insert')");
    const doris = buildDatabaseJobDefinitionQueries('doris', 'doris-job', '', '12', 'db')[0];
    expect(doris).toContain('ExecuteSql AS action');
    expect(doris).toContain('WHERE Id = 12');
    expect(buildDatabaseJobDefinitionQueries('doris', 'doris-job', '', '12;drop x', 'db')).toEqual([]);
    const starrocks = buildDatabaseJobDefinitionQueries('starrocks', 'starrocks-task', '', "task'\\", 'sales')[0];
    expect(starrocks).toContain('HEX(`DATABASE`)');
    expect(starrocks).toContain('HEX(TASK_NAME)');
    expect(starrocks).toContain('DEFINITION AS action');
  });
  it('rejects mismatched kinds rather than trying another engine catalog', () => {
    expect(buildDatabaseJobDefinitionQueries('starrocks', 'pg-cron', '', '1', 'db')).toEqual([]);
    expect(buildDatabaseJobDefinitionQueries('oceanbase-oracle', 'oracle-scheduler', 'APP', 'J')).toEqual([]);
  });
});

describe('capability probes and job identities', () => {
  it('skips an absent extension without querying or silently installing it', async () => {
    const calls: string[] = [];
    const result = await runDatabaseJobGroup(buildDatabaseJobListQueries('postgres', 'app')[0], async (sql) => {
      calls.push(sql); return { success: true, data: [{ available: false }] };
    }, 'failed');
    expect(result).toEqual({ success: false, rows: [], unavailable: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^SELECT /);
  });
  it('distinguishes permission errors and malformed responses from missing plugins', async () => {
    const group = buildDatabaseJobListQueries('postgres', 'app')[0];
    expect(await runDatabaseJobGroup(group, async () => ({ success: false, message: 'denied' }), 'failed')).toEqual({ success: false, rows: [], message: 'denied' });
    expect(await runDatabaseJobGroup(group, async () => ({ success: true, data: [] }), 'failed')).toEqual({ success: false, rows: [], message: 'failed' });
  });
  it('preserves identical display names by stable IDs and accepts catalog jobs without schema', () => {
    const rows = [{ job_name: '1', job_label: 'report' }, { job_name: '2', job_label: 'report' }];
    expect(normalizeDatabaseJobs(rows, 'pgagent', 'app')).toHaveLength(2);
    expect(normalizeDatabaseJobs(rows, 'kingbase-scheduler', 'app')).toHaveLength(2);
    expect(normalizeDatabaseJobs(rows, 'oracle-scheduler', 'APP')).toEqual([]);
  });
  it.each(DATABASE_JOB_KINDS)('restores %s with its source identity', (jobKind) => {
    const tab = { id: `job-${jobKind}`, title: 'display', connectionId: 'conn', type: 'job-def' as const, dbName: 'db', jobName: '1', jobLabel: 'daily', jobKind };
    expect(toSnapshotTab(tab)).toMatchObject({ jobKind, jobLabel: 'daily', jobName: '1' });
    const request = normalizeSidebarLocateObjectRequestFromTab(tab);
    expect(request).toMatchObject({ jobKind });
    if (request?.objectGroup !== 'jobs') throw new Error('missing locate identity');
    const target = resolveSidebarLocateTarget(request, { groupBySchema: true });
    expect(target.jobKind).toBe(jobKind);
    if (['pgagent', 'pg-cron', 'sqlserver-agent', 'kingbase-scheduler'].includes(jobKind)) {
      expect(target.schemaKey).toBeUndefined();
      expect(target.objectGroupKey).toBe('conn-db-jobs');
    }
  });
});
