import { describe, expect, it } from 'vitest';
import { DATABASE_JOB_KINDS, type DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { buildJobManagementPlan, createJobSources } from './jobManagementPlans';
import { supportedJobOperations, type JobCreateInput, type JobSnapshot, type JobTarget } from './jobManagementTypes';
import { numericID, pgBlock, pgText, qualifiedJob } from './jobManagementSQL';
import { jobManagementSnippets } from './jobManagementSnippets';
import { starRocksSupportsAlterTask } from './jobDistributedManagement';
import { hasJobMutationSQL } from './jobMutationClassifier';
import { findPotentiallyMutatingConnectionStatements } from '../connectionReadOnly';

const input: JobCreateInput = { name: 'new_job', action: 'SELECT 1', schedule: '0 0 * * *', program: 'program_1', scheduleName: 'schedule_1', jobType: 'PLSQL_BLOCK' };
const job = {
  job_name: '7', job_label: 'daily', job_id: '7', action: 'SELECT 1', repeat_interval: '0 0 * * *', database_name: 'app', comments: '',
  start_step_id: 1, enable: 0, enable_email: 0, email_operator_name: null, email_type: 0,
  enable_netsend: 0, netsend_operator_name: null, netsend_type: 0, describe: '', job_type: 'PLSQL_BLOCK',
};
const snapshot: JobSnapshot = { job, steps: [{ action: 'SELECT 1' }], schedules: [] };
const dialects: Record<DatabaseJobKind, JobTarget['dialect']> = {
  'oracle-scheduler': 'oracle', 'dbms-job': 'oracle', 'dm-agent': 'dm', 'sqlserver-agent': 'sqlserver', 'pg-cron': 'postgres', pgagent: 'postgres',
  'kingbase-scheduler': 'kingbase', 'opengauss-job': 'opengauss', 'gaussdb-job': 'gaussdb', 'oceanbase-oracle': 'oceanbase-oracle', 'oceanbase-mysql': 'oceanbase-mysql', 'doris-job': 'doris', 'starrocks-task': 'starrocks',
};
const targetFor = (kind: DatabaseJobKind): JobTarget => ({ dialect: dialects[kind], kind, name: kind === 'sqlserver-agent' ? '11111111-2222-3333-4444-555555555555' : '7', database: kind === 'sqlserver-agent' ? 'msdb' : 'app', owner: 'APP' });

describe('native job operation coverage', () => {
  for (const kind of DATABASE_JOB_KINDS) for (const operation of supportedJobOperations(kind)) {
    it(`${kind}: ${operation} produces executable management SQL, not a commented catalog`, () => {
      const metadata = { ...snapshot, steps: ['opengauss-job', 'gaussdb-job'].includes(kind) ? snapshot.steps : [] };
      const plan = buildJobManagementPlan(targetFor(kind), operation, metadata, input);
      expect(plan.sql.trim().length).toBeGreaterThan(10);
      expect(plan.sql).not.toMatch(/^--/);
      expect(plan.readOnly).toBe(['history', 'status'].includes(operation));
    });
  }
  it('never fabricates unavailable native APIs or uses delete/recreate as an edit', () => {
    for (const kind of ['kingbase-scheduler', 'doris-job'] as const) expect(() => buildJobManagementPlan(targetFor(kind), 'edit', snapshot, input)).toThrow('no_native_operation');
    expect(() => buildJobManagementPlan(targetFor('pg-cron'), 'run', snapshot, input)).toThrow('no_native_operation');
    expect(() => buildJobManagementPlan(targetFor('oceanbase-mysql'), 'create', snapshot, input)).toThrow('no_native_operation');
  });
  it('validates engine/source and msdb rather than borrowing a dialect', () => {
    expect(() => buildJobManagementPlan({ ...targetFor('pg-cron'), dialect: 'sqlserver' }, 'drop', snapshot, input)).toThrow();
    expect(createJobSources({ dialect: 'sqlserver', database: 'app' })).toEqual([]);
  });
  it('requires inputs instead of creating empty or guessed actions', () => {
    expect(() => buildJobManagementPlan(targetFor('oracle-scheduler'), 'create', snapshot, { ...input, name: '' })).toThrow('name_required');
    expect(() => buildJobManagementPlan(targetFor('pg-cron'), 'create', snapshot, { ...input, action: '' })).toThrow('action_required');
    expect(() => buildJobManagementPlan(targetFor('pg-cron'), 'create', snapshot, { ...input, schedule: '' })).toThrow('schedule_required');
  });
  it('creates PG cron disabled within the same transaction and never stores pgAgent passwords', () => {
    expect(buildJobManagementPlan(targetFor('pg-cron'), 'create', snapshot, input).sql).toContain('active := FALSE');
    const sql = buildJobManagementPlan(targetFor('pgagent'), 'create', snapshot, input).sql;
    expect(sql).toContain('RETURNING jobid INTO new_job_id');
    expect(sql).not.toContain('jstconnstr');
  });
  it('preserves named Oracle programs and schedules instead of inlining/replacing shared objects', () => {
    const plan = buildJobManagementPlan(targetFor('oracle-scheduler'), 'edit', { ...snapshot, job: { ...job, program_name: 'PROGRAM', program_owner: 'OTHER', schedule_name: 'SHARED' } }, input);
    expect(plan.sql).toContain('"OTHER"."PROGRAM"');
    expect(plan.sql).not.toContain("'job_action'");
    expect(plan.sql).not.toContain("'repeat_interval'");
    expect(plan.sql).not.toContain('DROP');
  });
  it('does not generate edits from missing essential metadata', () => {
    expect(() => buildJobManagementPlan(targetFor('pg-cron'), 'edit', { job: {}, steps: [], schedules: [] }, input)).toThrow('incomplete_metadata');
  });
  it('uses DM configuration on a single driver request and warns about implicit commits', () => {
    const plan = buildJobManagementPlan(targetFor('dm-agent'), 'create', snapshot, input);
    expect(plan.sql).toMatch(/^BEGIN/);
    expect(plan.sql).toContain('SP_JOB_CONFIG_START');
    expect(plan.sql).toContain('SP_JOB_CONFIG_COMMIT');
    expect(plan.warning).toContain('dm_commits');
  });
  it('keeps SQL Server schedules when deleting jobs and checks procedure return codes', () => {
    const plan = buildJobManagementPlan(targetFor('sqlserver-agent'), 'drop', snapshot, input);
    expect(plan.sql).toContain('@delete_unused_schedule=0');
    expect(plan.sql).toContain('IF @rc <> 0 THROW');
    expect(plan.sql).toContain('ROLLBACK TRANSACTION');
  });
  it.each(['3.4.9', '4.0.7', ''])('blocks ALTER TASK for old or unknown version %s', version => expect(starRocksSupportsAlterTask(version)).toBe(false));
  it.each(['4.1.0', '4.1.0-rc1', 'StarRocks 5.0.0'])('recognizes ALTER TASK syntax version %s', version => expect(starRocksSupportsAlterTask(version)).toBe(true));
  it('provides child CRUD snippets without deleting shared SQL Server schedules', () => {
    const snippets = jobManagementSnippets(targetFor('sqlserver-agent'));
    expect(snippets.map(s => s.key)).toEqual(['add_step', 'drop_step', 'add_schedule', 'drop_schedule']);
    expect(snippets.find(s => s.key === 'drop_schedule')?.sql).toContain('@delete_unused_schedule=0');
  });
});

describe('job identifiers and mutation classification', () => {
  it('preserves large numeric IDs and quotes metadata safely', () => {
    expect(numericID('9007199254740993123')).toBe('9007199254740993123');
    expect(() => numericID('1;DROP TABLE x')).toThrow();
    expect(pgText("x'\\y")).toBe("E'x''\\\\y'");
    expect(qualifiedJob('A"B', "x'y")).toBe("'\"A\"\"B\".\"x''y\"'");
    expect(pgBlock(["PERFORM f('$gonavi$')"])).toMatch(/^DO \$gonavi_\$/);
  });
  it.each(["SELECT cron.alter_job(1, active := true)", 'SELECT "cron" /*x*/ . "unschedule"(1)', "SELECT DBE_TASK.FINISH(1, TRUE, now())"])("classifies %s as mutating", sql => {
    expect(hasJobMutationSQL(sql, 'postgres')).toBe(true);
    expect(findPotentiallyMutatingConnectionStatements({ type: 'postgres' }, sql)).toEqual([sql]);
  });
  it.each(["SELECT 'cron.unschedule(1)'", 'SELECT $$cron.unschedule(1)$$', 'SELECT * FROM cron.job', 'SELECT 1 -- cron.unschedule(1)'])("does not mistake %s for a mutation", sql => expect(hasJobMutationSQL(sql, 'postgres')).toBe(false));
});
