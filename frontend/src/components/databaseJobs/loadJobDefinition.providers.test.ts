import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobKind, DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';

const backend = vi.hoisted(() => ({ query: vi.fn<(config: unknown, db: string, sql: string) => Promise<DatabaseJobQueryResult>>() }));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));
import { loadDatabaseJobDefinition } from './loadJobDefinition';
import { t } from '../../i18n';

const connection = (type: string, protocol?: 'mysql' | 'oracle'): SavedConnection => ({
  id: 'conn', name: type, config: { type, database: 'app', host: 'localhost', port: 5432, user: 'app', oceanBaseProtocol: protocol },
});
const tab = (jobKind: DatabaseJobKind, jobName = '7', dbName = 'app'): TabData => ({
  id: 'job', title: 'job', type: 'job-def', connectionId: 'conn', dbName, jobKind, jobName,
});
beforeEach(() => { backend.query.mockReset(); });

describe('provider definitions remain read-only', () => {
  it('loads SQL Server steps and schedules and retains transition metadata', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({ success: true, data: sql.includes('sysjobsteps')
      ? [{ step_id: 1, step_name: 'maintenance', action: 'EXEC app.dbo.maintenance;', success_action: 1, failure_action: 2 }]
      : sql.includes('sysjobschedules') ? [{ schedule_name: 'nightly', freq_type: 4, active_start_time: 10000 }]
        : [{ job_name: '12345678-1234-1234-1234-123456789abc', job_label: 'maintenance', start_step_id: 1 }] }));
    const result = await loadDatabaseJobDefinition(connection('sqlserver'), tab('sqlserver-agent', '12345678-1234-1234-1234-123456789abc', 'msdb'), t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain('EXEC app.dbo.maintenance;');
    expect(result.definition).toContain('freq_type: 4');
    expect(result.definition).toContain('start_step_id: 1');
    expect(backend.query.mock.calls.every(([, db, sql]) => db === 'msdb' && sql.startsWith('SELECT '))).toBe(true);
  });
  it('falls back to a legacy pg_cron catalog without dropping its action', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('jobname')
      ? { success: false, message: 'column not found' }
      : { success: true, data: [{ job_name: '7', action: 'VACUUM;', database_name: 'target', repeat_interval: '0 3 * * *' }] });
    const result = await loadDatabaseJobDefinition(connection('postgres'), tab('pg-cron'), t);
    expect(result.definition).toContain('VACUUM;');
    expect(result.definition).toContain('target');
    expect(result.error).toBeUndefined();
    expect(backend.query).toHaveBeenCalledTimes(2);
  });
  it('retains pgAgent base metadata when steps are denied', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('pga_jobstep')
      ? { success: false, message: 'permission denied' }
      : { success: true, data: sql.includes('pga_schedule') ? [{ jscminutes: [true, false], exception_date: '2026-12-25' }] : [{ job_name: '7', job_label: 'daily' }] });
    const result = await loadDatabaseJobDefinition(connection('postgres'), tab('pgagent'), t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain('daily');
    expect(result.definition).toContain('[true,false]');
    expect(result.definition).toContain('2026-12-25');
    expect(result.error).toContain('permission denied');
    expect(backend.query.mock.calls.map((call) => call[2]).join(' ')).not.toContain('jstconnstr');
  });
  it('loads Kingbase named program and schedule without filtering its NULL owner column', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({ success: true, data: sql.includes('dba_scheduler_programs')
      ? [{ action: 'CALL maintenance();', program_name: 'program' }]
      : sql.includes('dba_scheduler_schedules') ? [{ repeat_interval: 'FREQ=DAILY', schedule_name: 'schedule' }]
        : [{ job_name: 'nightly', program_name: 'program', schedule_name: 'schedule' }] }));
    const result = await loadDatabaseJobDefinition(connection('kingbase'), tab('kingbase-scheduler', 'nightly'), t);
    expect(result.definition).toContain('CALL maintenance();');
    expect(result.definition).toContain('FREQ=DAILY');
    expect(result.error).toBeUndefined();
    expect(backend.query.mock.calls.every((call) => !call[2].includes('OWNER ='))).toBe(true);
  });
  it.each(['opengauss', 'gaussdb'])('keeps %s properties when its action catalog is missing', async (type) => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('pg_job_proc')
      ? { success: false, message: 'catalog unavailable' }
      : { success: true, data: [{ job_name: '7', database_name: 'app', state: 'r' }] });
    const result = await loadDatabaseJobDefinition(connection(type), tab(`${type}-job` as DatabaseJobKind), t);
    expect(result.success).toBe(true);
    expect(result.error).toContain('catalog unavailable');
    expect(result.definition).toContain('app');
  });
  it('marks older OceanBase metadata as incomplete rather than inventing executable SQL', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('JOB_ACTION')
      ? { success: false, message: 'unknown column' }
      : { success: true, data: [{ schema_name: 'APP', job_name: 'nightly', state: 'SCHEDULED' }] });
    const result = await loadDatabaseJobDefinition(connection('oceanbase', 'oracle'), { ...tab('oceanbase-oracle', 'nightly'), schemaName: 'APP' }, t);
    expect(result.success).toBe(true);
    expect(result.error).toContain(t('database_jobs.warning.action_unavailable'));
    expect(result.definition).not.toContain('CREATE_JOB');
  });
  it.each([
    ['doris', 'doris-job', '7'], ['starrocks', 'starrocks-task', 'task'],
  ] as const)('preserves %s task action and database scope', async (type, kind, name) => {
    backend.query.mockResolvedValue({ success: true, data: [{ job_name: name, action: 'INSERT INTO report SELECT * FROM sales;', repeat_interval: 'EVERY(1 DAY)' }] });
    const result = await loadDatabaseJobDefinition(connection(type), tab(kind, name), t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain('INSERT INTO report SELECT * FROM sales;');
    expect(backend.query).toHaveBeenCalledTimes(1);
    expect(backend.query.mock.calls[0][2]).toMatch(/^SELECT /);
  });
  it('rejects a stored tab whose provider does not match the connection', async () => {
    expect((await loadDatabaseJobDefinition(connection('postgres'), tab('sqlserver-agent'), t)).success).toBe(false);
    expect(backend.query).not.toHaveBeenCalled();
  });
});
