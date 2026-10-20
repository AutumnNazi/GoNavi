import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: vi.fn() }));

import type { JobTarget } from '../../utils/databaseJobs/jobManagementTypes';
import { jobStatusSQL } from '../../utils/databaseJobs/jobStatusQueries';
import { loadJobManagementSnapshot } from './jobManagementMetadata';

const cases: Array<{ name: string; target: JobTarget; unsupported: string; expected: string }> = [
  {
    name: 'Dameng owner view after an unreadable DBA catalog',
    target: { dialect: 'dm', kind: 'dbms-job', database: 'APP', owner: 'APP', name: '42' },
    unsupported: 'FROM SYSJOB.DBA_JOBS', expected: 'FROM SYSJOB.USER_JOBS',
  },
  {
    name: 'older openGauss catalog without enable',
    target: { dialect: 'opengauss', kind: 'opengauss-job', database: 'app', owner: '', name: '42' },
    unsupported: 'enable AS enabled', expected: 'job_status AS state',
  },
  {
    name: 'older OceanBase catalog without action fields',
    target: { dialect: 'oceanbase-oracle', kind: 'oceanbase-oracle', database: 'APP', owner: 'APP', name: 'NIGHTLY' },
    unsupported: 'JOB_TYPE AS job_type', expected: 'SYS.DBA_SCHEDULER_JOBS',
  },
];

describe('status query after metadata fallback', () => {
  it.each(cases)('keeps the successfully read variant for $name', async ({ target, unsupported, expected }) => {
    const execute = vi.fn(async (sql: string) => sql.includes(unsupported)
      ? { success: false, message: 'catalog or column unavailable' }
      : { success: true, data: [{ job_name: target.name }] });
    const snapshot = await loadJobManagementSnapshot(target, execute, false);
    const status = jobStatusSQL(target, snapshot);
    expect(status).toContain(expected);
    expect(status).not.toContain(unsupported);
    expect((await execute(status)).success).toBe(true);
  });
});
