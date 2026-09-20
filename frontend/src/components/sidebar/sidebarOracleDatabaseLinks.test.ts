import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../wailsjs/go/app/App', () => ({
  DBQuery: vi.fn(),
}));

import { DBQuery } from '../../../wailsjs/go/app/App';
import type { SavedConnection } from '../../types';
import {
  buildOracleDatabaseLinksSQL,
  loadOracleDatabaseLinks,
  normalizeOracleDatabaseLinks,
} from './sidebarOracleDatabaseLinks';

const mockedDBQuery = vi.mocked(DBQuery);

const oracleConnection = {
  id: 'conn-oracle',
  name: 'Oracle',
  config: { type: 'oracle', host: '127.0.0.1', port: 1521, user: 'scott', password: 'tiger', database: 'ORCL' },
} as unknown as SavedConnection;

const mysqlConnection = {
  id: 'conn-mysql',
  name: 'MySQL',
  config: { type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'shop' },
} as unknown as SavedConnection;

beforeEach(() => {
  mockedDBQuery.mockReset();
});

describe('buildOracleDatabaseLinksSQL', () => {
  it('reads only the owner and link name for the selected schema', () => {
    const sql = buildOracleDatabaseLinksSQL('scott');

    expect(sql).toBe(
      "SELECT OWNER AS schema_name, DB_LINK AS database_link_name FROM ALL_DB_LINKS WHERE OWNER = 'SCOTT' ORDER BY DB_LINK",
    );
    expect(sql).not.toMatch(/USERNAME|HOST|PASSWORD/i);
  });

  it('escapes quotes in the schema name and falls back to the session user', () => {
    expect(buildOracleDatabaseLinksSQL("o'brien")).toContain("OWNER = 'O''BRIEN'");
    expect(buildOracleDatabaseLinksSQL('   ')).toContain('OWNER = USER');
  });
});

describe('normalizeOracleDatabaseLinks', () => {
  it('keeps dotted link names intact, dedupes and sorts case-insensitively', () => {
    const entries = normalizeOracleDatabaseLinks([
      { SCHEMA_NAME: 'SCOTT', DATABASE_LINK_NAME: 'ORCL.WORLD' },
      { schema_name: 'SCOTT', database_link_name: 'fccs_fckf222' },
      { OWNER: 'SCOTT', DB_LINK: 'FCCS_FCKF222' },
      { DB_LINK: 'ALPHA_LINK' },
      { OWNER: 'HR', DB_LINK: 'HR_LINK' },
      { OWNER: 'SCOTT', DB_LINK: '   ' },
      null,
      'not-a-row',
    ], 'SCOTT');

    expect(entries).toEqual([
      { schemaName: 'SCOTT', databaseLinkName: 'ALPHA_LINK' },
      { schemaName: 'SCOTT', databaseLinkName: 'fccs_fckf222' },
      { schemaName: 'SCOTT', databaseLinkName: 'ORCL.WORLD' },
    ]);
  });

  it('returns nothing for non-array payloads', () => {
    expect(normalizeOracleDatabaseLinks(undefined, 'SCOTT')).toEqual([]);
    expect(normalizeOracleDatabaseLinks({ rows: [] }, 'SCOTT')).toEqual([]);
  });
});

describe('loadOracleDatabaseLinks', () => {
  it('skips non-Oracle connections without touching the backend', async () => {
    const result = await loadOracleDatabaseLinks(mysqlConnection, 'shop');

    expect(result).toEqual({ databaseLinks: [], supported: false });
    expect(mockedDBQuery).not.toHaveBeenCalled();
  });

  it('queries ALL_DB_LINKS with the sidebar runtime config and normalizes the rows', async () => {
    mockedDBQuery.mockResolvedValue({
      success: true,
      data: [
        { SCHEMA_NAME: 'SCOTT', DATABASE_LINK_NAME: 'FCCS_FCKF222' },
        { SCHEMA_NAME: 'SCOTT', DATABASE_LINK_NAME: 'ORCL.WORLD' },
      ],
    } as any);

    const result = await loadOracleDatabaseLinks(oracleConnection, 'SCOTT');

    expect(result.supported).toBe(true);
    expect(result.failureMessage).toBeUndefined();
    expect(result.databaseLinks.map((entry) => entry.databaseLinkName)).toEqual(['FCCS_FCKF222', 'ORCL.WORLD']);
    expect(mockedDBQuery).toHaveBeenCalledTimes(1);
    const [config, dbName, sql] = mockedDBQuery.mock.calls[0];
    expect(config.type).toBe('oracle');
    // Oracle keeps the saved service name; the schema travels as dbName.
    expect(config.database).toBe('ORCL');
    expect(dbName).toBe('SCOTT');
    expect(sql).toContain("FROM ALL_DB_LINKS WHERE OWNER = 'SCOTT'");
  });

  it('reports a failed catalog query so the tree can surface a partial-metadata warning', async () => {
    mockedDBQuery.mockResolvedValue({ success: false, message: 'ORA-00942: table or view does not exist' } as any);

    const result = await loadOracleDatabaseLinks(oracleConnection, 'SCOTT');

    expect(result).toEqual({
      databaseLinks: [],
      supported: false,
      failureMessage: 'ORA-00942: table or view does not exist',
    });
  });

  it('turns a thrown transport error into a failure message', async () => {
    mockedDBQuery.mockRejectedValue(new Error('connection reset'));

    const result = await loadOracleDatabaseLinks(oracleConnection, 'SCOTT');

    expect(result.supported).toBe(false);
    expect(result.databaseLinks).toEqual([]);
    expect(result.failureMessage).toBe('connection reset');
  });
});
