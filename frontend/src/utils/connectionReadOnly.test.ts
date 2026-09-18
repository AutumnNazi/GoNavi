import { describe, expect, it } from 'vitest';

import {
  findConnectionMutatingStatements,
  findPotentiallyMutatingConnectionStatements,
  isConnectionDataEditRestricted,
  isConnectionDataImportRestricted,
  isConnectionScriptExecutionRestricted,
  isConnectionStructureEditRestricted,
  isSingleReadOnlyConnectionQuery,
  resolveConnectionProtectionConfig,
  supportsConnectionKeepAliveSQL,
  supportsConnectionReadOnlyMode,
} from './connectionReadOnly';

describe('connectionReadOnly', () => {
  it('accepts only one read-only SQL query for custom keepalive', () => {
    const config = { type: 'mysql' } as any;

    expect(supportsConnectionKeepAliveSQL(config)).toBe(true);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT 1')).toBe(true);
    expect(isSingleReadOnlyConnectionQuery(config, 'WITH probe AS (SELECT 1) SELECT * FROM probe')).toBe(true);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT 1; SELECT 2')).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, 'DELETE FROM accounts')).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, '/*!50000 DELETE FROM accounts */ SELECT 1')).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT /*!50000 SQL_NO_CACHE */ 1')).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, "SELECT ';' AS probe")).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT 1 /* ; */')).toBe(false);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT 1; -- probe')).toBe(true);
    expect(supportsConnectionKeepAliveSQL({ type: 'redis' } as any)).toBe(false);
  });

  it('supports Nacos production protection without treating it as a SQL keepalive source', () => {
    const config = { type: 'nacos' } as any;

    expect(supportsConnectionReadOnlyMode(config)).toBe(true);
    expect(supportsConnectionKeepAliveSQL(config)).toBe(false);
  });

  it('supports Elasticsearch production protection without treating it as a SQL keepalive source', () => {
    const config = { type: 'elasticsearch' } as any;

    expect(supportsConnectionReadOnlyMode(config)).toBe(true);
    expect(supportsConnectionKeepAliveSQL(config)).toBe(false);
  });

  it('supports Caché production protection and SQL keepalive checks', () => {
    const config = { type: 'cache' } as any;

    expect(supportsConnectionReadOnlyMode(config)).toBe(true);
    expect(supportsConnectionKeepAliveSQL(config)).toBe(true);
    expect(isSingleReadOnlyConnectionQuery(config, 'SELECT 1')).toBe(true);
    expect(isSingleReadOnlyConnectionQuery(config, 'UPDATE Sample.Person SET Name = \'next\'')).toBe(false);
  });

  it('maps legacy readOnly connections to the full production protection set', () => {
    expect(resolveConnectionProtectionConfig({
      type: 'postgres',
      readOnly: true,
    })).toEqual({
      restrictDataEdit: true,
      restrictStructureEdit: true,
      restrictScriptExecution: true,
      restrictDataImport: true,
    });
  });

  it('keeps partial protection flags isolated from each other', () => {
    const config = {
      type: 'postgres',
      protection: {
        restrictDataEdit: true,
        restrictDataImport: true,
      },
    };

    expect(isConnectionDataEditRestricted(config)).toBe(true);
    expect(isConnectionDataImportRestricted(config)).toBe(true);
    expect(isConnectionStructureEditRestricted(config)).toBe(false);
    expect(isConnectionScriptExecutionRestricted(config)).toBe(false);
  });

  it('only blocks mutating SQL when script execution protection is enabled', () => {
    expect(findConnectionMutatingStatements({
      type: 'postgres',
      protection: {
        restrictScriptExecution: true,
      },
    }, "SELECT * FROM users; UPDATE users SET name = 'next';")).toEqual([
      "UPDATE users SET name = 'next'",
    ]);

    expect(findConnectionMutatingStatements({
      type: 'postgres',
      protection: {
        restrictDataEdit: true,
      },
    }, "UPDATE users SET name = 'next';")).toEqual([]);
  });

  it('detects potentially mutating SQL even when protection is disabled', () => {
    const config = { type: 'postgres' } as any;

    expect(findPotentiallyMutatingConnectionStatements(
      config,
      'SELECT * FROM users;',
    )).toEqual([]);
    expect(findPotentiallyMutatingConnectionStatements(
      config,
      "SELECT * FROM users; UPDATE users SET name = 'next';",
    )).toEqual(["UPDATE users SET name = 'next'"]);
  });

  it('does not treat literals, comments, or quoted identifiers as SELECT INTO', () => {
    const config = { type: 'postgres' } as any;
    const sql = [
      "SELECT 'into' AS marker",
      'SELECT 1 /* INTO should stay a comment */',
      'SELECT [into] FROM records',
    ].join(';');

    expect(findPotentiallyMutatingConnectionStatements(config, sql)).toEqual([]);
    expect(findPotentiallyMutatingConnectionStatements(
      config,
      'SELECT value INTO archive FROM records',
    )).toEqual(['SELECT value INTO archive FROM records']);
  });

  it('does not treat text in a CTE literal or comment as a mutating keyword', () => {
    const config = { type: 'postgres' } as any;

    expect(findPotentiallyMutatingConnectionStatements(
      config,
      "WITH probe AS (SELECT 'update' AS operation /* delete */) SELECT * FROM probe",
    )).toEqual([]);
    expect(findPotentiallyMutatingConnectionStatements(
      config,
      'WITH changed AS (UPDATE accounts SET active = true RETURNING *) SELECT * FROM changed',
    )).toEqual([
      'WITH changed AS (UPDATE accounts SET active = true RETURNING *) SELECT * FROM changed',
    ]);
    expect(findPotentiallyMutatingConnectionStatements(
      config,
      'WITH source AS (SELECT id FROM accounts) SELECT id INTO archived_accounts FROM source',
    )).toEqual([
      'WITH source AS (SELECT id FROM accounts) SELECT id INTO archived_accounts FROM source',
    ]);
  });

  it('does not treat SQL Server REPLACE functions in a read-only CTE as writes', () => {
    const config = { type: 'sqlserver' } as any;
    const sql = `WITH OracleData_CTE AS (
      SELECT
        T.c.value('c[1]', 'INT') AS ID,
        T.c.value('c[2]', 'DATE') AS OrderDate,
        T.c.value('c[3]', 'DECIMAL(18,2)') AS Amount,
        T.c.value('c[4]', 'NVARCHAR(2)') AS rn
      FROM (
        SELECT CAST(
          '<root><r><c>' +
          REPLACE(REPLACE('101|2026-01-01|500|1', '||', '</c></r><r><c>'), '|', '</c><c>') +
          '</c></r></root>' AS XML
        ) AS XmlData
      ) x
      CROSS APPLY x.XmlData.nodes('/root/r') AS T(c)
    )
    SELECT O.ID, O.OrderDate, O.Amount, O.rn
    FROM OracleData_CTE O`;

    expect(findPotentiallyMutatingConnectionStatements(config, sql)).toEqual([]);
  });

  it('uses the connection dialect when filtering comment-only statements', () => {
    expect(findConnectionMutatingStatements({
      type: 'postgres',
      protection: {
        restrictScriptExecution: true,
      },
    }, 'SELECT * FROM users; /*! MySQL-only comment */')).toEqual([]);

    expect(findConnectionMutatingStatements({
      type: 'mysql',
      protection: {
        restrictScriptExecution: true,
      },
    }, 'SELECT * FROM users;--compact')).toEqual(['--compact']);
  });

  it('allows MongoDB distinct and read-only aggregate shell commands', () => {
    const config = {
      type: 'mongodb',
      protection: { restrictScriptExecution: true },
    };

    expect(findConnectionMutatingStatements(
      config,
      'db.users.distinct("status", { active: true }); db.users.aggregate([{ $match: { active: true } }])',
    )).toEqual([]);
  });

  it('keeps aggregate pipelines with write stages protected', () => {
    const config = {
      type: 'mongodb',
      protection: { restrictScriptExecution: true },
    };
    const statement = 'db.users.aggregate([{ $match: {} }, { $out: "archive" }])';

    expect(findConnectionMutatingStatements(config, statement)).toEqual([statement]);
    expect(findConnectionMutatingStatements(
      config,
      'db.users.aggregate([{ $match: {} }, { $merge: { into: "archive" } }])',
    )).toEqual(['db.users.aggregate([{ $match: {} }, { $merge: { into: "archive" } }])']);
  });
});
