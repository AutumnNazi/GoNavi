import { describe, expect, it } from 'vitest';
import {
  buildDatabaseJobListQueries, buildDatabaseJobDefinitionQueries,
  buildDamengJobChildQueries, buildOracleJobReferenceQueries,
} from './jobQueries';
import { resolveDatabaseJobDialect } from './jobCapabilities';
import { normalizeDatabaseJobs } from './jobMetadata';

describe('database job catalog scope', () => {
  it('preserves a quoted owner and escapes SQL literals in both Oracle catalogs', () => {
    const groups = buildDatabaseJobListQueries('oracle', "MiX'ed.Owner");
    expect(groups.map((group) => group.kind)).toEqual(['oracle-scheduler', 'dbms-job']);
    expect(groups.every((group) => group.queries.every((sql) => sql.includes("'MiX''ed.Owner'")))).toBe(true);
    expect(groups.flatMap((group) => group.queries).join('\n')).not.toMatch(/DBA_|USER_SCHEDULER_JOBS/);
  });

  it('uses the actual session owner when no schema is selected', () => {
    const queries = buildDatabaseJobListQueries('oracle', '').flatMap((group) => group.queries);
    expect(queries[0]).toContain('OWNER = USER');
    expect(queries[1]).toContain('SCHEMA_USER = USER');
  });

  it('uses SYSJOB catalogs for both native and Oracle-compatible Dameng jobs', () => {
    const groups = buildDatabaseJobListQueries('dm', 'APP');
    expect(groups[0].queries).toHaveLength(2);
    expect(groups[0].queries[0]).toContain('FROM SYSJOB.SYSJOBS');
    expect(groups[0].queries[1]).toContain('FROM SYSJOB.USER_JOBS_VIEW');
    expect(groups[0].queries.every((sql) => sql.includes("USERNAME = 'APP'"))).toBe(true);
    expect(groups[1].queries[0]).toContain('FROM SYSJOB.DBA_JOBS');
    expect(groups[1].queries[1]).toContain('FROM SYSJOB.USER_JOBS');
    expect(groups.every((group) => group.probeQueries?.[0].includes("OWNER = 'SYSJOB'"))).toBe(true);
    expect(buildDatabaseJobListQueries('sqlite', 'APP')).toEqual([]);
  });

  it('uses documented Dameng creation-time and step columns instead of Oracle-style aliases', () => {
    const definitions = buildDatabaseJobDefinitionQueries('dm', 'dm-agent', 'APP', 'NIGHTLY');
    expect(definitions.every((sql) => sql.includes('CREATETIME AS create_time'))).toBe(true);
    const children = buildDamengJobChildQueries('APP', 'NIGHTLY');
    for (const sql of children.steps) {
      expect(sql).toContain('ID AS step_id, SEQNO AS step_sequence');
      expect(sql).toContain('DBNAME AS database_name');
      expect(sql).toContain('ORDER BY SEQNO, ID');
    }
    expect([...definitions, ...children.steps, ...children.schedules].join('\n')).not.toMatch(/SYSJOB\.ALL_|CREATE_TIME|STEPID|SCHNAME AS schema_name/);
  });

  it('treats a dotted job name as one exact name instead of a qualified identifier', () => {
    const queries = buildDatabaseJobDefinitionQueries('oracle', 'oracle-scheduler', 'MiXeD', "nightly.report'1");
    expect(queries[0]).toContain("OWNER = 'MiXeD'");
    expect(queries[0]).toContain("JOB_NAME = 'nightly.report''1'");
  });

  it('rejects non-numeric legacy job IDs and mismatched sources', () => {
    for (const id of ['1 OR 1=1', '-2', '0;DELETE', '1.5']) {
      expect(buildDatabaseJobDefinitionQueries('oracle', 'dbms-job', 'APP', id)).toEqual([]);
    }
    expect(buildDatabaseJobDefinitionQueries('dm', 'oracle-scheduler', 'APP', 'job')).toEqual([]);
    expect(buildDatabaseJobDefinitionQueries('oracle', 'dm-agent', 'APP', 'job')).toEqual([]);
  });

  it('keeps both child catalogs scoped by job name and owner', () => {
    const children = buildDamengJobChildQueries("User'1", "job'1");
    for (const [index, sql] of [...children.steps, ...children.schedules].entries()) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).toContain("USERNAME = 'User''1'");
      expect(sql).toContain("NAME = 'job''1'");
      expect(sql).toContain(`JOBID IN (SELECT ID FROM SYSJOB.${index % 2 === 0 ? 'SYSJOBS' : 'USER_JOBS_VIEW'}`);
    }
    expect(children.steps[1]).toContain('FROM SYSJOB.USER_JOBSTEPS_VIEW');
    expect(children.schedules[1]).toContain('FROM SYSJOB.USER_JOBSCHEDULES_VIEW');
  });

  it('escapes and preserves names for referenced programs and schedules', () => {
    const sql = buildOracleJobReferenceQueries('program', "Owner'1", 'A.B')[0];
    expect(sql).toContain("OWNER = 'Owner''1' AND PROGRAM_NAME = 'A.B'");
    expect(buildOracleJobReferenceQueries('schedule', '', 'A')).toEqual([]);
  });
});

describe('job row identities and source capabilities', () => {
  it('does not collapse quoted identifiers or discard zero-valued legacy IDs', () => {
    const rows = [
      { SCHEMA_NAME: 'MiXeD', JOB_NAME: 'A.B' },
      { schema_name: 'MiXeD', job_name: 'A.B' },
      { schema_name: 'MiXeD', job_name: 'a.b' },
      { schema_name: 'MIXED', job_name: 'A.B' },
    ];
    expect(normalizeDatabaseJobs(rows, 'oracle-scheduler', 'MiXeD').map((job) => job.jobName)).toEqual(['A.B', 'a.b']);
    expect(normalizeDatabaseJobs([{ schema_name: 'APP', job_name: 0, broken: 'Y' }], 'dbms-job', 'APP')).toEqual([
      expect.objectContaining({ jobName: '0', enabled: 'FALSE', state: 'Y' }),
    ]);
  });

  it('limits job support to native engines and explicit custom drivers', () => {
    expect(resolveDatabaseJobDialect({ type: 'oracle' })).toBe('oracle');
    expect(resolveDatabaseJobDialect({ type: 'dameng' })).toBe('dm');
    expect(resolveDatabaseJobDialect({ type: 'custom', driver: 'dm' })).toBe('dm');
    expect(resolveDatabaseJobDialect({ type: 'custom', driver: 'oracle' })).toBe('oracle');
    expect(resolveDatabaseJobDialect({ type: 'oceanbase', oceanBaseProtocol: 'oracle' })).toBe('oceanbase-oracle');
    expect(resolveDatabaseJobDialect({ type: 'mysql' })).toBeNull();
  });
});
