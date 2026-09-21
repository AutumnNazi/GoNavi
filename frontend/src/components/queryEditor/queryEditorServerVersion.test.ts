import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSqlDialectConstraint,
  ensureDatabaseServerVersion,
  ensureQueryEditorAiContextServerVersion,
  peekDatabaseServerVersion,
  resetDatabaseServerVersionCache,
  setDatabaseServerVersionQuery,
} from './queryEditorServerVersion';

describe('query editor server version cache', () => {
  afterEach(() => {
    resetDatabaseServerVersionCache();
    setDatabaseServerVersionQuery(null);
  });

  it('queries once and reuses the cached version for AI context', async () => {
    let calls = 0;
    setDatabaseServerVersionQuery(async () => {
      calls += 1;
      return { success: true, message: '5.7.44-log' };
    });

    const connection = {
      id: 'mysql-legacy',
      config: { type: 'mysql', host: '127.0.0.1', port: 3306 },
    };
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('5.7.44-log');
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('5.7.44-log');
    expect(calls).toBe(1);
    expect(peekDatabaseServerVersion('mysql-legacy')).toBe('5.7.44-log');

    await expect(ensureQueryEditorAiContextServerVersion({
      connectionId: 'mysql-legacy',
    })).resolves.toEqual({
      connectionId: 'mysql-legacy',
      databaseVersion: '5.7.44-log',
    });
  });

  it('builds a version-honoring SQL constraint for the AI workspace', () => {
    expect(buildSqlDialectConstraint('KingbaseES V8 R6')).toContain('KingbaseES V8 R6');
    expect(buildSqlDialectConstraint('')).toContain('unknown');
  });

  it('retries a failed version lookup instead of caching an unknown version', async () => {
    let calls = 0;
    setDatabaseServerVersionQuery(async () => ({
      success: ++calls > 1,
      message: calls > 1 ? '5.7.44-log' : 'connection temporarily unavailable',
    }));
    const connection = { id: 'mysql-legacy', config: { type: 'mysql' } };
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('');
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('5.7.44-log');
    expect(calls).toBe(2);
  });

  it('caches a successful empty result for sources without a version probe', async () => {
    let calls = 0;
    setDatabaseServerVersionQuery(async () => {
      calls += 1;
      return { success: true, data: [] };
    });
    const connection = { id: 'unsupported', config: { type: 'mongodb' } };
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('');
    await expect(ensureDatabaseServerVersion(connection)).resolves.toBe('');
    expect(calls).toBe(1);
  });
});
