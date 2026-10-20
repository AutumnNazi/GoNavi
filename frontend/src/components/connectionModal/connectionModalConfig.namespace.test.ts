import { describe, expect, it } from 'vitest';
import { buildConnectionConfig, buildSavedConnectionInput, createEmptyConnectionSecretClearState } from './connectionModalConfig';
import { getInterSystemsURINamespace, resolveConnectionDatabaseValue, usesInterSystemsNamespace } from './connectionModalNamespace';

const translate = (key: string) => key;

describe.each(['iris', 'cache'])('%s namespace configuration', (type) => {
  it.each([true, false])('preserves an explicit namespace for persist=%s', async (forPersist) => {
    const config = await buildConnectionConfig({
      values: { type, host: 'localhost', port: 1972, database: '  APP_DATA  ' },
      forPersist,
      translate,
    });
    expect(config.database).toBe('APP_DATA');
    expect(config.type).toBe(type);
  });

  it('keeps blank namespace eligible for discovery rather than forcing USER', async () => {
    const config = await buildConnectionConfig({
      values: { type, database: '  ' }, forPersist: true, translate,
    });
    expect(config.database).toBe('');
  });

  it('matches backend URI namespace precedence when saving and reopening', async () => {
    const uri = `${type}://user@localhost:1972/APP_DATA`;
    const config = await buildConnectionConfig({
      values: { type, database: 'OLD_NAMESPACE', uri }, forPersist: true, translate,
    });
    expect(config.database).toBe('APP_DATA');
    expect(config.uri).toBe(uri);
    expect(resolveConnectionDatabaseValue(type, undefined, uri)).toBe('APP_DATA');
    expect(resolveConnectionDatabaseValue(type, 'OLD_NAMESPACE', uri)).toBe('APP_DATA');
  });

  it.each([
    'iris://localhost:1972/%25SYS',
    'intersystems://localhost:1972/%25SYS',
    'cache://localhost:1972/%25SYS',
    'intersystems-cache://localhost:1972/%25SYS',
    'intersystemscache://localhost:1972/%25SYS',
    ' JDBC: IRIS://user@localhost:1972//%25SYS//?timeout=30#fragment ',
    'jdbc:cache://[::1]:1972/%2F%25SYS%2F',
  ])('uses backend URI precedence for %s in both test and save configs', async (uri) => {
    expect(resolveConnectionDatabaseValue(type, undefined, uri)).toBe('%SYS');
    for (const forPersist of [false, true]) {
      const config = await buildConnectionConfig({
        values: { type, database: 'OLD_NAMESPACE', uri }, forPersist, translate,
      });
      expect(config.database).toBe('%SYS');
      expect(config.uri).toBe(uri.trim());
    }
  });

  it.each(['', `jdbc:${type}://localhost:1972`, `${type}://localhost:1972///`])('keeps manual namespace or discovery when URI has no target: %s', async (uri) => {
    for (const database of ['', '  /APP_DATA/  ']) {
      for (const forPersist of [false, true]) {
        const config = await buildConnectionConfig({ values: { type, database, uri }, forPersist, translate });
        expect(config.database).toBe(database ? 'APP_DATA' : '');
      }
    }
  });

  it('does not rewrite an old display scope to match the connection target', async () => {
    const config = await buildConnectionConfig({
      values: { type, database: 'APP_DATA' }, forPersist: true, translate,
    });
    const input = buildSavedConnectionInput({
      config,
      values: { type, name: 'app', includeDatabases: ['OLD_NAMESPACE'], includeDatabasePatterns: ['LEGACY*'] },
      clearSecrets: createEmptyConnectionSecretClearState(),
    });
    expect(input.config.database).toBe('APP_DATA');
    expect(input.includeDatabases).toEqual(['OLD_NAMESPACE']);
    expect(input.includeDatabasePatterns).toEqual(['LEGACY*']);
  });
});

describe('namespace URI path parsing', () => {
  it.each([
    ['iris://localhost:1972/APP/../DATA', 'APP/../DATA'],
    ['iris:/%25SYS', '%SYS'],
    ['iris://localhost:1972//APP%20DATA//?namespace=OTHER#ignored', 'APP DATA'],
    ['iris://localhost:1972/%E5%91%BD%E5%90%8D%E7%A9%BA%E9%97%B4', '命名空间'],
    ['iris://localhost:1972/APP+DATA', 'APP+DATA'],
  ])('decodes the unnormalized Go URI path for %s', (uri, expected) => {
    expect(getInterSystemsURINamespace('iris', uri)).toBe(expected);
  });

  it.each([
    'postgres://localhost:1972/OTHER', 'iris:APP_DATA',
    'iris://localhost:1972/%ZZ', 'iris://user%ZZ@localhost:1972/APP',
    'iris://localhost:invalid/APP', 'iris://[broken/APP',
  ])('ignores unsupported or invalid URI paths: %s', (uri) => {
    expect(getInterSystemsURINamespace('iris', uri)).toBe('');
    expect(resolveConnectionDatabaseValue('iris', 'MANUAL_APP', uri)).toBe('MANUAL_APP');
  });
});

describe('namespace type detection', () => {
  it.each(['iris', 'IRIS', 'intersystems', 'cache', 'Caché', 'InterSystems Caché'])('normalizes %s through existing driver types', (type) => {
    expect(usesInterSystemsNamespace(type)).toBe(true);
  });

  it('does not change other database connection semantics', () => {
    expect(usesInterSystemsNamespace('nacos')).toBe(false);
    expect(resolveConnectionDatabaseValue('postgres', ' FORM_DB ', 'postgres://host/URI_DB')).toBe(' FORM_DB ');
  });
});
