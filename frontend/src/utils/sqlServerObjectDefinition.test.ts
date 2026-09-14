import { describe, expect, it } from 'vitest';

import { buildSqlServerObjectDefinitionQueries } from './sqlServerObjectDefinition';

describe('buildSqlServerObjectDefinitionQueries', () => {
  it('builds schema-aware SQL Server routine definition queries', () => {
    const queries = buildSqlServerObjectDefinitionQueries('routine', 'dbo.p_get_select', 'BizDB', 'routine_definition');

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('FROM sys.all_sql_modules AS m');
    expect(queries[0]).toContain('JOIN sys.all_objects AS o ON o.object_id = m.object_id');
    expect(queries[0]).toContain("WHERE o.name = N'p_get_select'");
    expect(queries[0]).toContain("AND s.name = N'dbo'");
    expect(queries[0]).toContain("o.type IN ('P', 'PC', 'RF', 'FN', 'FS', 'FT', 'IF', 'TF')");
    expect(queries[0]).not.toContain('OBJECT_DEFINITION');
    expect(queries[0]).not.toContain('[BizDB].sys.');
    expect(queries[1]).toBe("EXEC sys.sp_helptext @objname = N'[dbo].[p_get_select]'");
  });

  it('uses the database segment from a three-part SQL Server object name', () => {
    const queries = buildSqlServerObjectDefinitionQueries('view', 'Archive.reporting.active_users', 'BizDB', 'view_definition');

    expect(queries[0]).toContain('FROM sys.all_sql_modules AS m');
    expect(queries[0]).toContain("WHERE o.name = N'active_users'");
    expect(queries[0]).toContain("AND s.name = N'reporting'");
    expect(queries[0]).toContain("o.type IN ('V')");
    expect(queries[0]).not.toContain('[Archive].sys.');
    expect(queries[1]).toBe("EXEC sys.sp_helptext @objname = N'[reporting].[active_users]'");
  });

  it('falls back to all schemas when SQL Server object name is unqualified', () => {
    const queries = buildSqlServerObjectDefinitionQueries('routine', 'sp_helptext', 'master', 'routine_definition');

    expect(queries[0]).toContain('FROM sys.all_sql_modules AS m');
    expect(queries[0]).toContain("WHERE o.name = N'sp_helptext'");
    expect(queries[0]).not.toContain('AND s.name = N');
    expect(queries[0]).toContain("CASE WHEN s.name = N'dbo' THEN 0 WHEN s.name = N'sys' THEN 1 ELSE 2 END");
    expect(queries[1]).toBe("EXEC sys.sp_helptext @objname = N'sp_helptext'");
  });

  it('escapes SQL Server literals and bracket identifiers', () => {
    const queries = buildSqlServerObjectDefinitionQueries('trigger', "audit]x.o'clock", 'Biz]DB', 'trigger_definition');

    expect(queries[0]).toContain('FROM sys.all_sql_modules AS m');
    expect(queries[0]).toContain("WHERE o.name = N'o''clock'");
    expect(queries[0]).toContain("AND s.name = N'audit]x'");
    expect(queries[1]).toBe("EXEC sys.sp_helptext @objname = N'[audit]]x].[o''clock]'");
  });
});
