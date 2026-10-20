import { describe, expect, it } from 'vitest';
import { buildJobManagementPlan } from './jobManagementPlans';
import type { JobCreateInput, JobSnapshot, JobTarget } from './jobManagementTypes';

const input: JobCreateInput = { name: '', action: '', schedule: '', program: '', scheduleName: '', jobType: '' };
const sqlTarget: JobTarget = { dialect: 'sqlserver', kind: 'sqlserver-agent', database: 'msdb', owner: '', name: '11111111-2222-3333-4444-555555555555' };
const sqlSnapshot: JobSnapshot = {
  job: { job_label: "night's task", comments: 'maintenance', start_step_id: 2 },
  steps: [{ step_id: 2, step_name: 'second', step_type: 'TSQL', action: "SELECT N'a''b'", database_name: 'warehouse', success_action: 4, on_success_step_id: 3, failure_action: 2, on_fail_step_id: 0, retry_attempts: 4, retry_interval: 5 }],
  schedules: [{ schedule_id: 9, schedule_name: 'monthly', enabled: 1, freq_type: 16, freq_interval: 2, freq_subday_type: 1, freq_subday_interval: 0, freq_relative_interval: 0, freq_recurrence_factor: 2, active_start_date: 20260101, active_end_date: 99991231, active_start_time: 123000, active_end_time: 235959 }],
};

describe('native child editing preserves existing settings', () => {
  it('preserves SQL Server step routing, retries and complete schedule fields', () => {
    const { sql } = buildJobManagementPlan(sqlTarget, 'edit', sqlSnapshot, input);
    expect(sql).toContain("@new_name=N'night''s task'");
    expect(sql).toContain("@database_name=N'warehouse'");
    expect(sql).toContain('@on_success_action=4, @on_success_step_id=3');
    expect(sql).toContain('@retry_attempts=4, @retry_interval=5');
    expect(sql).toContain('@freq_type=16, @freq_interval=2');
    expect(sql).toContain('@freq_recurrence_factor=2');
    expect(sql).toContain('@active_start_time=123000');
    expect(sql).toContain('WHERE schedule_id=9) > 1 THROW');
    expect(sql).not.toMatch(/sp_delete|sp_drop/);
  });
  it('refuses incomplete SQL Server step metadata', () => {
    const steps = [{ ...sqlSnapshot.steps[0], retry_attempts: undefined }];
    expect(() => buildJobManagementPlan(sqlTarget, 'edit', { ...sqlSnapshot, steps }, input)).toThrow('incomplete_metadata');
  });
  it('preserves DM notifications, step output, retries and schedule boundaries', () => {
    const target: JobTarget = { dialect: 'dm', kind: 'dm-agent', database: 'APP', owner: 'APP', name: 'nightly' };
    const snapshot: JobSnapshot = {
      job: { ENABLE: 1, ENABLE_EMAIL: 1, EMAIL_OPERATOR_NAME: 'ops', EMAIL_TYPE: 2, ENABLE_NETSEND: 0, NETSEND_OPERATOR_NAME: null, NETSEND_TYPE: 0, DESCRIBE: 'backup' },
      steps: [{ NAME: 'export', TYPE: 0, COMMAND: 'CALL backup_data()', SUCC_ACTION: 0, FAIL_ACTION: 1, RETRY_ATTEMPTS: 3, RETRY_INTERVAL: 10, OUTPUT_FILE_PATH: 'D:\\logs\\job.txt', APPEND_FLAG: 1 }],
      schedules: [{ NAME: 'daily', ENABLE: 1, TYPE: 1, FREQ_INTERVAL: 1, FREQ_SUB_INTERVAL: 0, FREQ_MINUTE_INTERVAL: 0, STARTTIME: '01:30:00', ENDTIME: '23:59:59', DURING_START_DATE: '2026-01-01', DURING_END_DATE: null, DESCRIBE: '' }],
    };
    const { sql, warning } = buildJobManagementPlan(target, 'edit', snapshot, input);
    expect(warning).toBe('database_jobs.manage.dm_commits');
    expect(sql).toContain("SP_ALTER_JOB('nightly', 1, 1, 'ops', 2, 0, NULL, 0, 'backup')");
    expect(sql).toContain("3, 10, 'D:\\logs\\job.txt', 1)");
    expect(sql).toContain("'01:30:00', '23:59:59', '2026-01-01', NULL, '')");
    expect(sql.indexOf('SP_JOB_CONFIG_START')).toBeLessThan(sql.indexOf('SP_ALTER_JOB_STEP'));
    expect(sql.indexOf('SP_JOB_CONFIG_COMMIT')).toBeGreaterThan(sql.indexOf('SP_ALTER_JOB_SCHEDULE'));
  });
  it('deduplicates pgAgent schedules joined with exceptions without replacing secrets or exceptions', () => {
    const target: JobTarget = { dialect: 'postgres', kind: 'pgagent', database: 'app', owner: '', name: '7' };
    const schedule = { schedule_id: 9, schedule_name: 'daily', enabled: true, start_date: '2026-01-01T00:00:00Z', end_date: null, jscminutes: '{t,f}', jschours: [true, false], jscweekdays: '{t}', jscmonthdays: '{t}', jscmonths: '{t}' };
    const snapshot: JobSnapshot = { job: { job_label: 'nightly', comments: '' }, steps: [{ step_id: 3, step_name: 'remote step', step_type: 's', action: 'SELECT 1', database_name: '', enabled: true, failure_action: 'f' }], schedules: [{ ...schedule, exception_id: 1 }, { ...schedule, exception_id: 2 }] };
    const { sql } = buildJobManagementPlan(target, 'edit', snapshot, input);
    expect(sql.match(/UPDATE pgagent.pga_schedule/g)).toHaveLength(1);
    expect(sql).toContain('WHERE jstjobid = 7 AND jstid = 3');
    expect(sql).toContain('WHERE jscjobid = 7 AND jscid = 9');
    expect(sql).not.toMatch(/jstconnstr|pga_exception|DELETE|DROP/);
  });
});
