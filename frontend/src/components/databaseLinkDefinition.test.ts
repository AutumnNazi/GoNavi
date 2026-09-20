import { describe, expect, it } from 'vitest';

import {
  buildOracleDatabaseLinkDefinitionQueries,
  extractOracleDatabaseLinkDefinition,
} from './databaseLinkDefinition';

const copy = {
  notFoundComment: 'not found',
  passwordUnavailableComment: 'password is not stored in the catalog',
};

describe('buildOracleDatabaseLinkDefinitionQueries', () => {
  it('keeps dotted link names whole and does not request the password', () => {
    const queries = buildOracleDatabaseLinkDefinitionQueries('ORCL.WORLD', 'H2');

    expect(queries[0]).toContain('ALL_DB_LINKS');
    expect(queries[0]).toContain("OWNER = 'H2'");
    expect(queries[0]).toContain("DB_LINK = 'ORCL.WORLD'");
    expect(queries.some((query) => query.includes("GET_DDL('DB_LINK', 'ORCL.WORLD', 'H2')"))).toBe(true);
    expect(queries.join('\n')).not.toMatch(/PASSWORD/i);
  });

  it('escapes quotes in owner and link names', () => {
    const queries = buildOracleDatabaseLinkDefinitionQueries("O'LINK", "O'WNER");
    expect(queries[0]).toContain("OWNER = 'O''WNER'");
    expect(queries[0]).toContain("DB_LINK = 'O''LINK'");
  });
});

describe('extractOracleDatabaseLinkDefinition', () => {
  it('reconstructs a readable statement from ALL_DB_LINKS without inventing a password', () => {
    const definition = extractOracleDatabaseLinkDefinition([
      {
        SCHEMA_NAME: 'H2',
        DATABASE_LINK_NAME: 'BJDBUAT',
        USERNAME: 'APP',
        HOST: 'bjdbuat.example.com:1521/ORCL',
        CREATED: '2024-01-02',
      },
    ], 'BJDBUAT', 'H2', copy);

    expect(definition).toContain('-- Created: 2024-01-02');
    expect(definition).toContain(copy.passwordUnavailableComment);
    expect(definition).toContain('CREATE DATABASE LINK "BJDBUAT"');
    expect(definition).toContain('CONNECT TO "APP"');
    expect(definition).toContain("USING 'bjdbuat.example.com:1521/ORCL'");
    expect(definition).not.toMatch(/IDENTIFIED BY/i);
  });

  it('prefers catalog columns over GET_DDL so hashed passwords never reach the editor', () => {
    const definition = extractOracleDatabaseLinkDefinition([
      {
        DATABASE_LINK_NAME: 'BJDBUAT',
        USERNAME: 'APP',
        HOST: 'bjdbuat',
        DDL: 'CREATE DATABASE LINK "BJDBUAT" IDENTIFIED BY VALUES \'xx\' USING \'bjdbuat\';',
      },
    ], 'BJDBUAT', 'H2', copy);

    expect(definition).toContain('CREATE DATABASE LINK "BJDBUAT"');
    expect(definition).not.toMatch(/IDENTIFIED BY/i);
  });

  it('strips IDENTIFIED BY from GET_DDL when catalog columns are absent', () => {
    const definition = extractOracleDatabaseLinkDefinition([
      { DDL: 'CREATE DATABASE LINK "BJDBUAT"\n   CONNECT TO "APP" IDENTIFIED BY VALUES \'xx\'\n   USING \'bjdbuat\';' },
    ], 'BJDBUAT', 'H2', copy);

    expect(definition).toContain('-- password is not stored in the catalog');
    expect(definition).toContain('CREATE DATABASE LINK "BJDBUAT"');
    expect(definition).toContain('CONNECT TO "APP"');
    expect(definition).toContain("USING 'bjdbuat'");
    expect(definition).not.toMatch(/IDENTIFIED BY/i);
  });

  it('unwraps Oracle CLOB objects returned as sql.NullString', () => {
    const definition = extractOracleDatabaseLinkDefinition([
      { ddl: { String: 'CREATE DATABASE LINK "H2TEST" USING \'h2test\'', Valid: true } },
    ], 'H2TEST', 'H2', copy);

    expect(definition).toContain('CREATE DATABASE LINK "H2TEST"');
    expect(definition).toContain("USING 'h2test'");
  });

  it('omits CONNECT TO for connected-user links', () => {
    const definition = extractOracleDatabaseLinkDefinition([
      { database_link_name: 'H2CARRY', host: 'h2carry' },
    ], 'H2CARRY', 'H2', copy);

    expect(definition).toContain('CREATE DATABASE LINK "H2CARRY"');
    expect(definition).not.toContain('CONNECT TO');
    expect(definition).toContain("USING 'h2carry'");
  });

  it('returns the not-found comment for empty payloads', () => {
    expect(extractOracleDatabaseLinkDefinition([], 'BJDBUAT', 'H2', copy)).toBe('-- not found');
    expect(extractOracleDatabaseLinkDefinition(undefined, 'BJDBUAT', 'H2', copy)).toBe('-- not found');
  });
});
