import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';

const backend = vi.hoisted(() => ({
  query: vi.fn<(config: unknown, database: string, sql: string) => Promise<DatabaseJobQueryResult>>(),
}));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));

import { loadDatabaseJobs } from './sidebarDatabaseJobs';

const connection = (type = 'dameng'): SavedConnection => ({
  id: 'dm-catalog', name: 'DM', config: { type, host: '127.0.0.1', port: 5236, user: 'APP', database: 'DM' },
});
const missingView = { success: false, message: 'Error -2106: 第1 行附近出现错误: 无效的表或视图名[USER_JOBS]' };
const isProbe = (sql: string): boolean => sql.includes('FROM SYS.ALL_OBJECTS');

beforeEach(() => { backend.query.mockReset(); });

describe('Dameng optional job catalogs', () => {
  it.each(['dameng', 'dm', 'dm8'])('loads SYSJOB legacy jobs without the reported USER_JOBS warning for %s', async (type) => {
    backend.query.mockImplementation(async (_config, _database, sql) => {
      if (isProbe(sql)) return { success: true, data: [{ AVAILABLE: 1 }] };
      if (sql.includes('FROM SYSJOB.SYSJOBS')) return { success: true, data: [] };
      if (sql.includes('FROM SYSJOB.DBA_JOBS')) return { success: false, message: 'permission denied' };
      if (sql.includes('FROM SYSJOB.USER_JOBS')) return { success: true, data: [{ SCHEMA_NAME: 'APP', JOB_NAME: 42, BROKEN: 'N' }] };
      return missingView;
    });
    const result = await loadDatabaseJobs(connection(type), 'APP');
    expect(result.failureMessage).toBeUndefined();
    expect(result.jobs).toEqual([expect.objectContaining({ jobName: '42', jobKind: 'dbms-job', enabled: 'TRUE' })]);
    expect(backend.query.mock.calls.every((call) => !call[2].includes('SYS.USER_JOBS'))).toBe(true);
  });

  it('skips both optional sources when the job environment has not been initialized', async () => {
    backend.query.mockImplementation(async (_config, _database, sql) => isProbe(sql)
      ? { success: true, data: [{ available: 0 }] } : missingView);
    expect(await loadDatabaseJobs(connection(), 'APP')).toEqual({ supported: false, jobs: [] });
    expect(backend.query.mock.calls.every((call) => isProbe(call[2]))).toBe(true);
  });

  it('keeps native jobs when only the compatible DBMS_JOB catalog is unavailable', async () => {
    backend.query.mockImplementation(async (_config, _database, sql) => {
      if (isProbe(sql)) return { success: true, data: [{ available: sql.includes("'SYSJOBS'") ? 1 : 0 }] };
      if (sql.includes('FROM SYSJOB.SYSJOBS')) return { success: true, data: [{ SCHEMA_NAME: 'APP', JOB_NAME: 'NIGHTLY' }] };
      return missingView;
    });
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.failureMessage).toBeUndefined();
    expect(result.jobs).toEqual([expect.objectContaining({ jobName: 'NIGHTLY', jobKind: 'dm-agent' })]);
    expect(backend.query.mock.calls.filter((call) => !isProbe(call[2]))).toHaveLength(1);
  });

  it('keeps compatible jobs when only the native agent catalog is unavailable', async () => {
    backend.query.mockImplementation(async (_config, _database, sql) => {
      if (isProbe(sql)) return { success: true, data: [{ available: sql.includes("'SYSJOBS'") ? 0 : 1 }] };
      if (sql.includes('FROM SYSJOB.DBA_JOBS')) return { success: true, data: [{ SCHEMA_NAME: 'APP', JOB_NAME: 7 }] };
      return missingView;
    });
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.failureMessage).toBeUndefined();
    expect(result.jobs).toEqual([expect.objectContaining({ jobName: '7', jobKind: 'dbms-job' })]);
    expect(backend.query.mock.calls.filter((call) => !isProbe(call[2]))).toHaveLength(1);
  });

  it.each(['permission denied', 'network unavailable', 'Error -2111: invalid column name'])('retains real query failures: %s', async (message) => {
    backend.query.mockImplementation(async (_config, _database, sql) => isProbe(sql)
      ? { success: true, data: [{ available: 1 }] } : { success: false, message });
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.supported).toBe(false);
    expect(result.failureMessage).toContain(message);
  });

  it('reports a failed catalog probe instead of treating it as successful absence', async () => {
    backend.query.mockRejectedValue(new Error('catalog connection lost'));
    const result = await loadDatabaseJobs(connection(), 'APP');
    expect(result.failureMessage).toContain('catalog connection lost');
  });

  it('keeps the requested owner scope when falling back to the current-user view', async () => {
    backend.query.mockImplementation(async (_config, _database, sql) => {
      if (isProbe(sql)) return { success: true, data: [{ available: 1 }] };
      if (sql.includes('FROM SYSJOB.SYSJOBS')) return { success: true, data: [] };
      if (sql.includes('FROM SYSJOB.DBA_JOBS')) return { success: false, message: 'permission denied' };
      return { success: true, data: [{ SCHEMA_NAME: 'APP', JOB_NAME: 42 }] };
    });
    expect(await loadDatabaseJobs(connection(), 'OTHER')).toEqual({ supported: true, jobs: [] });
    const legacyQueries = backend.query.mock.calls.filter((call) => /FROM SYSJOB\.(DBA_JOBS|USER_JOBS) /.test(call[2]));
    expect(legacyQueries).toHaveLength(2);
    expect(legacyQueries.every((call) => call[2].includes("SCHEMA_USER = 'OTHER'"))).toBe(true);
  });
});
