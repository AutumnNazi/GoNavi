import { describe, expect, it } from 'vitest';

import {
  buildOracleObjectCompileSQL,
  buildOracleObjectErrorsSQL,
  collectOracleCompileTargets,
  formatOracleCompileErrors,
  loadOracleCompileErrors,
  normalizeOracleObjectCompileStatus,
  parseOracleCompileErrorRows,
  resolveOracleCompileTarget,
  supportsOracleObjectCompilation,
} from './oracleObjectCompilation';

describe('Oracle object compilation helpers', () => {
  it('normalizes only Oracle compiler states that can be presented in the sidebar', () => {
    expect(normalizeOracleObjectCompileStatus(' valid ')).toBe('VALID');
    expect(normalizeOracleObjectCompileStatus('INVALID')).toBe('INVALID');
    expect(normalizeOracleObjectCompileStatus('ENABLED')).toBe('');
  });

  it('recognizes Oracle-like dialects that report INVALID objects after CREATE OR REPLACE', () => {
    expect(supportsOracleObjectCompilation('oracle')).toBe(true);
    expect(supportsOracleObjectCompilation('dameng')).toBe(true);
    expect(supportsOracleObjectCompilation('dm')).toBe(true);
    expect(supportsOracleObjectCompilation('mysql')).toBe(false);
  });

  it('builds schema-qualified and safely quoted compile statements', () => {
    expect(buildOracleObjectCompileSQL({
      kind: 'routine',
      objectName: 'APP."refresh.daily"',
      routineType: 'PROCEDURE',
    })).toBe('ALTER PROCEDURE "APP"."refresh.daily" COMPILE');

    expect(buildOracleObjectCompileSQL({
      kind: 'trigger',
      objectName: 'TRG_AUDIT',
      schemaName: 'APP',
    })).toBe('ALTER TRIGGER "APP"."TRG_AUDIT" COMPILE');
  });

  it('refuses unsupported routine kinds and malformed object references', () => {
    expect(buildOracleObjectCompileSQL({
      kind: 'routine',
      objectName: 'APP.P_REBUILD',
      routineType: 'PACKAGE',
    })).toBe('');
    expect(buildOracleObjectCompileSQL({
      kind: 'trigger',
      objectName: 'A.B.C',
    })).toBe('');
  });

  it('collects CREATE OR REPLACE and ALTER COMPILE targets including quoted names', () => {
    expect(collectOracleCompileTargets([
      '-- 修改过程\nCREATE OR REPLACE PROCEDURE cproc_tzhssr_order2sale_A1(\n  p_id IN NUMBER\n) AS\nBEGIN\n  NULL;\nEND;',
      'ALTER PACKAGE APP.pkg_order COMPILE BODY',
      'CREATE OR REPLACE FUNCTION "APP"."refresh.daily" RETURN NUMBER IS BEGIN RETURN 1; END;',
    ])).toEqual([
      { objectType: 'PROCEDURE', objectName: 'CPROC_TZHSSR_ORDER2SALE_A1' },
      { objectType: 'PACKAGE BODY', objectName: 'PKG_ORDER', schemaName: 'APP' },
      { objectType: 'FUNCTION', objectName: 'refresh.daily', schemaName: 'APP' },
    ]);
  });

  it('builds ALL_ERRORS lookups from compiled object identity', () => {
    expect(resolveOracleCompileTarget({
      kind: 'routine',
      objectName: 'APP.P_REBUILD',
      routineType: 'PROCEDURE',
    })).toEqual({
      objectType: 'PROCEDURE',
      objectName: 'P_REBUILD',
      schemaName: 'APP',
    });

    expect(buildOracleObjectErrorsSQL([
      { objectType: 'PROCEDURE', objectName: 'P_REBUILD', schemaName: 'APP' },
    ], 'ALL_ERRORS')).toContain("FROM ALL_ERRORS WHERE (OWNER = 'APP' AND NAME = 'P_REBUILD' AND TYPE = 'PROCEDURE')");
  });

  it('formats compiler diagnostics and ignores warnings', () => {
    const errors = parseOracleCompileErrorRows([
      {
        OBJECT_NAME: 'P_REBUILD',
        OBJECT_TYPE: 'PROCEDURE',
        ERROR_LINE: 12,
        ERROR_POSITION: 5,
        ERROR_TEXT: "PLS-00201: identifier 'MISSING_TABLE' must be declared",
      },
      {
        object_name: 'P_REBUILD',
        object_type: 'PROCEDURE',
        error_text: 'PLW-06009: procedure is true but never used',
        attribute: 'WARNING',
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(formatOracleCompileErrors(errors)).toContain("PLS-00201: identifier 'MISSING_TABLE' must be declared");
    expect(formatOracleCompileErrors(errors)).toContain('line 12');
  });

  it('loads USER_ERRORS and ALL_ERRORS then de-duplicates the same diagnostic', async () => {
    const sqls: string[] = [];
    const errors = await loadOracleCompileErrors([
      { objectType: 'PROCEDURE', objectName: 'P_REBUILD', schemaName: 'APP' },
    ], {
      query: async (sql) => {
        sqls.push(sql);
        return {
          success: true,
          data: [{
            object_name: 'P_REBUILD',
            object_type: 'PROCEDURE',
            error_sequence: 1,
            error_line: 8,
            error_position: 1,
            error_text: 'PLS-00103: Encountered the symbol "END"',
          }],
        };
      },
    });

    expect(sqls.some((sql) => sql.includes('FROM ALL_ERRORS'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('FROM USER_ERRORS'))).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain('PLS-00103');
  });
});
