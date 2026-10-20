import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';

const backend = vi.hoisted(() => ({
  query: vi.fn<(config: unknown, dbName: string, sql: string) => Promise<DatabaseJobQueryResult>>(),
}));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));

import { loadDatabaseJobDefinition } from './loadJobDefinition';
import { t } from '../../i18n';

const connection: SavedConnection = {
  id: 'conn', name: 'Oracle',
  config: { type: 'oracle', host: 'localhost', port: 1521, user: 'APP', database: 'ORCL' },
};
const tab: TabData = {
  id: 'job', title: 'Nightly job', type: 'job-def', connectionId: 'conn',
  dbName: 'APP', schemaName: 'APP', jobName: 'NIGHTLY', jobKind: 'oracle-scheduler',
};

beforeEach(() => { backend.query.mockReset(); });

describe('read-only job definitions', () => {
  it('preserves exact execution content and does not synthesize CREATE_JOB SQL', async () => {
    const action = 'BEGIN\n  maintain_report;\nEND;';
    backend.query.mockResolvedValue({ success: true, data: [{
      SCHEMA_NAME: 'APP', JOB_NAME: 'NIGHTLY', ACTION: action,
      REPEAT_INTERVAL: 'FREQ=DAILY', ENABLED: 'TRUE', NEXT_RUN_AT: '2026-10-14 01:00:00',
    }] });
    const result = await loadDatabaseJobDefinition(connection, tab, t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain(action);
    expect(result.definition).toContain('FREQ=DAILY');
    expect(result.definition).toContain('2026-10-14 01:00:00');
    expect(result.definition).not.toContain('CREATE_JOB');
    expect(backend.query).toHaveBeenCalledTimes(1);
  });

  it('resolves the actual program action and a referenced schedule', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({
      success: true, data: sql.includes('ALL_SCHEDULER_PROGRAMS')
        ? [{ PROGRAM_NAME: 'REPORT_PROGRAM', ACTION: 'APP.REPORT_PROCEDURE' }]
        : sql.includes('ALL_SCHEDULER_SCHEDULES')
          ? [{ SCHEDULE_NAME: 'NIGHTLY_SCHEDULE', REPEAT_INTERVAL: 'FREQ=DAILY;BYHOUR=1' }]
          : [{ JOB_NAME: 'NIGHTLY', PROGRAM_OWNER: 'APP', PROGRAM_NAME: 'REPORT_PROGRAM', SCHEDULE_OWNER: 'APP', SCHEDULE_NAME: 'NIGHTLY_SCHEDULE' }],
    }));
    const result = await loadDatabaseJobDefinition(connection, tab, t);
    expect(result.definition).toContain('APP.REPORT_PROCEDURE');
    expect(result.definition).toContain('FREQ=DAILY;BYHOUR=1');
    expect(backend.query.mock.calls.every((call) => call[2].startsWith('SELECT '))).toBe(true);
  });

  it('keeps properties visible when a named reference cannot be read', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('ALL_SCHEDULER_PROGRAMS')
      ? { success: false, message: 'ORA-01031' }
      : { success: true, data: [{ JOB_NAME: 'NIGHTLY', PROGRAM_OWNER: 'APP', PROGRAM_NAME: 'HIDDEN_PROGRAM' }] });
    const result = await loadDatabaseJobDefinition(connection, tab, t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain('HIDDEN_PROGRAM');
    expect(result.error).toContain('ORA-01031');
  });

  it('reads the legacy WHAT body, interval and broken state', async () => {
    backend.query.mockResolvedValue({ success: true, data: [{
      JOB_NAME: 18, ACTION: 'APP.CLEANUP;', REPEAT_INTERVAL: 'SYSDATE + 1', BROKEN: 'Y',
    }] });
    const result = await loadDatabaseJobDefinition(connection, { ...tab, jobKind: 'dbms-job', jobName: '18' }, t);
    expect(result.definition).toContain('APP.CLEANUP;');
    expect(result.definition).toContain('SYSDATE + 1');
    expect(backend.query.mock.calls[0][2]).toContain('WHAT AS action');
  });

  it('loads ordered Dameng steps and all schedules without dropping command text', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({
      success: true,
      data: sql.includes('SYSJOBSTEPS') ? [{ STEP_ID: 0, STEP_SEQUENCE: 1, STEP_NAME: 'cleanup', DATABASE_NAME: 'DM', ACTION: 'DELETE FROM old_data;' }, { STEP_ID: 1, STEP_SEQUENCE: 2, ACTION: 'CALL APP.REPORT();' }]
        : sql.includes('SYSJOBSCHEDULES') ? [{ TYPE: 1, FREQ_INTERVAL: 1, STARTTIME: '01:00:00' }]
          : [{ JOB_NAME: 'NIGHTLY', SCHEMA_NAME: 'APP', JOB_ID: 100, ENABLED: 1 }],
    }));
    const result = await loadDatabaseJobDefinition(
      { ...connection, config: { ...connection.config, type: 'dameng' } },
      { ...tab, jobKind: 'dm-agent' }, t,
    );
    expect(result.definition).toContain('DELETE FROM old_data;');
    expect(result.definition).toContain('CALL APP.REPORT();');
    expect(result.definition!.indexOf('DELETE FROM')).toBeLessThan(result.definition!.indexOf('CALL APP.REPORT'));
    expect(result.definition).toContain('01:00:00');
    expect(result.definition).toContain(`${t('database_jobs.field.database_name')}: DM`);
    expect(backend.query.mock.calls.every((call) => call[2].startsWith('SELECT '))).toBe(true);
  });

  it('reports inaccessible Dameng child catalogs while preserving job properties', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => /SYSJOB\.(?:SYSJOBSTEPS|SYSJOBSCHEDULES|USER_JOBSTEPS_VIEW|USER_JOBSCHEDULES_VIEW)/.test(sql)
      ? { success: false, message: 'permission denied' }
      : { success: true, data: [{ JOB_NAME: 'NIGHTLY', JOB_ID: 100 }] });
    const result = await loadDatabaseJobDefinition(
      { ...connection, config: { ...connection.config, type: 'dameng' } },
      { ...tab, jobKind: 'dm-agent' }, t,
    );
    expect(result.success).toBe(true);
    expect(result.definition).toContain('NIGHTLY');
    expect(result.error).toContain('permission denied');
  });

  it('loads native Dameng definitions and children through documented owner views after permission errors', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => {
      if (/SYSJOB\.SYSJOBS/.test(sql)) return { success: false, message: 'permission denied' };
      if (sql.includes('USER_JOBSTEPS_VIEW')) return { success: true, data: [{ STEP_ID: 5, STEP_SEQUENCE: 1, ACTION: 'CALL APP.CLEANUP();' }] };
      if (sql.includes('USER_JOBSCHEDULES_VIEW')) return { success: true, data: [{ STARTTIME: '02:00:00' }] };
      return { success: true, data: [{ JOB_NAME: 'NIGHTLY', SCHEMA_NAME: 'APP', CREATE_TIME: '2026-10-13 00:00:00' }] };
    });
    const result = await loadDatabaseJobDefinition(
      { ...connection, config: { ...connection.config, type: 'dameng' } },
      { ...tab, jobKind: 'dm-agent' }, t,
    );
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.definition).toContain('CALL APP.CLEANUP();');
    expect(result.definition).toContain('02:00:00');
    expect(result.definition).toContain('2026-10-13 00:00:00');
    expect(backend.query).toHaveBeenCalledTimes(6);
  });

  it('returns not-found when a job is deleted instead of displaying a successful empty definition', async () => {
    backend.query.mockResolvedValue({ success: true, data: [] });
    const result = await loadDatabaseJobDefinition(connection, tab, t);
    expect(result).toEqual({ success: false, error: t('database_jobs.error.not_found') });
  });

  it('rejects unsupported or unsafe identities before querying', async () => {
    expect((await loadDatabaseJobDefinition(connection, { ...tab, jobName: '' }, t)).success).toBe(false);
    expect((await loadDatabaseJobDefinition(connection, { ...tab, jobKind: 'dbms-job', jobName: '18 OR 1=1' }, t)).success).toBe(false);
    expect(backend.query).not.toHaveBeenCalled();
  });
});
