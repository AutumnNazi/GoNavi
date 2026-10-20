import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';

const backend = vi.hoisted(() => ({
  query: vi.fn<(config: unknown, dbName: string, sql: string) => Promise<DatabaseJobQueryResult>>(),
}));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));

import { loadDatabaseJobs } from './sidebarDatabaseJobs';

const connection = (type = 'oracle'): SavedConnection => ({
  id: 'job-conn', name: type,
  config: { type, host: '127.0.0.1', port: 1521, user: 'APP', database: 'ORCL' },
});

beforeEach(() => { backend.query.mockReset(); });

describe('loadDatabaseJobs', () => {
  it('merges scheduler and legacy jobs without losing their source identities', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({
      success: true, data: sql.includes('ALL_SCHEDULER_JOBS')
        ? [{ SCHEMA_NAME: 'APP', JOB_NAME: '123', ENABLED: 'TRUE', STATE: 'SCHEDULED' }]
        : [{ SCHEMA_NAME: 'APP', JOB_NAME: 123, BROKEN: 'N' }],
    }));
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.supported).toBe(true);
    expect(result.failureMessage).toBeUndefined();
    expect(result.jobs.map((job) => job.jobKind).sort()).toEqual(['dbms-job', 'oracle-scheduler']);
    expect(backend.query).toHaveBeenCalledTimes(2);
  });

  it('preserves the available source and reports the inaccessible source', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('ALL_SCHEDULER_JOBS')
      ? { success: false, message: 'ORA-01031' }
      : { success: true, data: [{ schema_name: 'APP', job_name: 7, broken: 'Y' }] });
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.supported).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].enabled).toBe('FALSE');
    expect(result.failureMessage).toContain('ORA-01031');
  });

  it('reports total failure instead of presenting an empty successful catalog', async () => {
    backend.query.mockRejectedValue(new Error('network unavailable'));
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.supported).toBe(false);
    expect(result.jobs).toEqual([]);
    expect(result.failureMessage).toContain('network unavailable');
  });

  it('accepts an empty successful catalog and rejects non-array success payloads', async () => {
    backend.query.mockResolvedValue({ success: true, data: [] });
    expect(await loadDatabaseJobs(connection(), 'APP')).toEqual({ supported: true, jobs: [] });
    backend.query.mockResolvedValue({ success: true, data: {} });
    expect((await loadDatabaseJobs(connection(), 'APP')).supported).toBe(false);
  });

  it('rejects rows from a different owner even if a driver returns them', async () => {
    backend.query.mockResolvedValue({
      success: true,
      data: [{ schema_name: 'OTHER', job_name: 'wrong_job' }, { schema_name: 'MiXeD', job_name: 'A.B' }],
    });
    const result = await loadDatabaseJobs(connection(), 'MiXeD');
    expect(result.jobs.map((job) => job.schemaName)).toEqual(['MiXeD']);
  });

  it('queries the native and compatible Dameng catalogs with read-only SQL', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({
      success: true, data: sql.includes('FROM SYS.ALL_OBJECTS') ? [{ available: 1 }] : [],
    }));
    await loadDatabaseJobs(connection('dameng'), 'APP');
    const queries = backend.query.mock.calls.map((call) => call[2]);
    expect(queries.some((sql) => sql.includes('SYSJOB.SYSJOBS'))).toBe(true);
    expect(queries.some((sql) => sql.includes('FROM SYSJOB.DBA_JOBS'))).toBe(true);
    expect(queries.every((sql) => sql.startsWith('SELECT '))).toBe(true);
  });

  it('falls back to the scoped owner view when Dameng system tables are inaccessible', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('FROM SYS.ALL_OBJECTS')
      ? { success: true, data: [{ available: 1 }] }
      : sql.includes('SYSJOB.SYSJOBS')
      ? { success: false, message: 'permission denied' }
      : { success: true, data: sql.includes('SYSJOB.USER_JOBS_VIEW') ? [{ SCHEMA_NAME: 'APP', JOB_NAME: 'NIGHTLY' }] : [] });
    const result = await loadDatabaseJobs(connection('dameng'), 'APP');
    expect(result.jobs).toEqual([expect.objectContaining({ jobName: 'NIGHTLY', jobKind: 'dm-agent' })]);
    expect(result.failureMessage).toBeUndefined();
    expect(backend.query.mock.calls.filter((call) => call[2].includes('USERNAME')).every((call) => call[2].includes("USERNAME = 'APP'"))).toBe(true);
  });

  it('does not retry a successful empty Dameng catalog using a different scope', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({
      success: true, data: sql.includes('FROM SYS.ALL_OBJECTS') ? [{ available: 1 }] : [],
    }));
    expect(await loadDatabaseJobs(connection('dameng'), 'OTHER')).toEqual({ supported: true, jobs: [] });
    expect(backend.query).toHaveBeenCalledTimes(4);
    expect(backend.query.mock.calls.some((call) => call[2].includes('FROM SYSJOB.USER_JOBS_VIEW'))).toBe(false);
    expect(backend.query.mock.calls.find((call) => call[2].includes('FROM SYSJOB.SYSJOBS'))?.[2]).toContain("USERNAME = 'OTHER'");
  });

  it('skips unsupported engines without any database calls', async () => {
    expect(await loadDatabaseJobs(connection('mysql'), 'APP')).toEqual({ jobs: [], supported: false });
    expect(backend.query).not.toHaveBeenCalled();
  });
});
