import { describe, expect, it } from 'vitest';
import { buildJobManagementPlan } from './jobManagementPlans';
import { resolveJobManagementDialect, type JobCreateInput, type JobTarget } from './jobManagementTypes';
import { eventManagementPlan } from './jobEventManagement';

const target: JobTarget = { dialect: 'mysql', kind: 'mysql-event', name: 'tick', owner: '', database: 'reports' };
const input: JobCreateInput = { name: 'tick', action: 'INSERT INTO audit VALUES (1)', schedule: 'EVERY 1 DAY', program: '', scheduleName: '', jobType: '' };
const snapshot = { job: { sql_mode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', session_sql_mode: 'NO_ENGINE_SUBSTITUTION,STRICT_TRANS_TABLES', time_zone: '+08:00', session_time_zone: '+08:00', create_event: 'CREATE DEFINER=`a@b`@`localhost` EVENT `tick` ON SCHEDULE EVERY 1 DAY ON COMPLETION PRESERVE DISABLE DO INSERT INTO audit VALUES (1)' }, steps: [], schedules: [] };
describe('MySQL/MariaDB event management without a duplicate Jobs group', () => {
  it.each(['mysql', 'mariadb'])('resolves %s for management separately', type => expect(resolveJobManagementDialect({ type, host: '', port: 3306, user: '' })).toBe(type));
  it('creates disabled events without switching on the global scheduler', () => {
    const plan = buildJobManagementPlan(target, 'create', snapshot, input);
    expect(plan.sql).toContain('DISABLE'); expect(plan.sql).toContain('ON COMPLETION PRESERVE'); expect(plan.sql).not.toMatch(/SET.*event_scheduler/i);
  });
  it('edits in place while retaining the exact quoted definer', () => {
    const sql = eventManagementPlan(target, 'edit', snapshot, input).sql;
    expect(sql).toBe(snapshot.job.create_event.replace('CREATE', 'ALTER')); expect(sql).not.toContain('DROP');
  });
  it.each(['enable', 'disable'] as const)('preserves the definer when applying %s', operation => {
    expect(eventManagementPlan(target, operation, snapshot, input).sql).toBe(`ALTER DEFINER=\`a@b\`@\`localhost\` EVENT \`reports\`.\`tick\` ${operation.toUpperCase()};`);
  });
  it('refuses to silently take ownership when SHOW CREATE metadata is missing', () => {
    expect(() => eventManagementPlan(target, 'enable', { ...snapshot, job: { ...snapshot.job, create_event: 'CREATE EVENT tick DO SELECT 1' } }, input)).toThrow('incomplete_metadata');
  });
  it.each(['edit', 'enable', 'disable'] as const)('rejects a SQL mode change during %s', operation => {
    const metadata = { ...snapshot, job: { ...snapshot.job, session_sql_mode: 'NO_BACKSLASH_ESCAPES' } };
    expect(() => eventManagementPlan(target, operation, metadata, input)).toThrow('event_session_mismatch');
  });
  it('rejects an implicit schedule time-zone shift', () => {
    const metadata = { ...snapshot, job: { ...snapshot.job, session_time_zone: '+00:00' } };
    expect(() => eventManagementPlan(target, 'edit', metadata, input)).toThrow('event_session_mismatch');
  });
  it('quotes database and event identifiers independently', () => {
    expect(eventManagementPlan({ ...target, database: 'a`b', name: 'x.y' }, 'drop', snapshot, input).sql).toBe('DROP EVENT `a``b`.`x.y`;');
  });
  it.each(['run', 'stop', 'history'] as const)('does not invent a native %s interface for events', operation => {
    expect(() => buildJobManagementPlan(target, operation, snapshot, input)).toThrow('no_native_operation');
  });
});
