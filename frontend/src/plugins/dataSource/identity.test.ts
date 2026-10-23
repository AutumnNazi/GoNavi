import { describe, expect, it } from 'vitest';
import { parsePluginDataSourceType, isPluginDataSourceNamespace } from './identity';
import { normalizeConnectionType } from '../../store/storeConnectionSanitizers';
import { normalizeDriverType } from '../../utils/connectionDriverType';
import { resolveSqlDialect } from '../../utils/sqlDialectCore';

describe('strict plugin datasource identity', () => {
  it.each(['mysql', 'postgres', 'sqlite'])('preserves %s identity while resolving syntax only', (dialect) => {
    const type = 'plugin:mysql.vendor:reader:' + dialect;
    expect(parsePluginDataSourceType(type)).toEqual({ type, pluginId: 'mysql.vendor', id: 'reader', dialect });
    expect(normalizeConnectionType(type)).toBe(type); expect(normalizeDriverType(type)).toBe(type);
    expect(resolveSqlDialect(type)).toBe(dialect);
  });
  it.each(['plugin', 'Plugin', 'Plugin:demo.source:reader:mysql', 'plugin:Demo.source:reader:mysql',
    'plugin:demo.source:Reader:mysql', 'plugin:demo.source:reader:postgresql', 'plugin:demo.source::mysql',
    'plugin:demo.source:reader:mysql:extra', 'plugin:iris.vendor:reader:unknown', ' plugin:demo.source:reader:mysql '])('never repairs or defaults malformed reserved identity %s', (type) => {
    expect(isPluginDataSourceNamespace(type)).toBe(true); expect(parsePluginDataSourceType(type)).toBeNull();
    expect(normalizeConnectionType(type)).toBe(type); expect(normalizeDriverType(type)).toBe(type);
    expect(resolveSqlDialect(type)).toBe('unknown');
  });
  it('preserves builtin alias behavior', () => {
    expect(normalizeConnectionType('PostgreSQL')).toBe('postgres'); expect(normalizeDriverType('pg')).toBe('postgres');
    expect(resolveSqlDialect('mysql')).toBe('mysql'); expect(normalizeConnectionType('not-a-plugin')).toBe('mysql');
  });
});
