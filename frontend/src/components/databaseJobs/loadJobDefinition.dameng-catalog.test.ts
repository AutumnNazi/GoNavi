import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';

const backend = vi.hoisted(() => ({
  query: vi.fn<(config: unknown, database: string, sql: string) => Promise<DatabaseJobQueryResult>>(),
}));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));

import { t } from '../../i18n';
import { loadDatabaseJobDefinition } from './loadJobDefinition';
import { loadJobManagementSnapshot } from './jobManagementMetadata';

const connection: SavedConnection = {
  id: 'dm-definition', name: 'DM', config: { type: 'dameng', host: '127.0.0.1', port: 5236, user: 'APP', database: 'DM' },
};
const tab: TabData = {
  id: 'dm-job', title: '42', type: 'job-def', connectionId: connection.id,
  dbName: 'APP', schemaName: 'APP', jobName: '42', jobKind: 'dbms-job',
};

beforeEach(() => {
  backend.query.mockReset();
  backend.query.mockImplementation(async (_config, _database, sql) => sql.includes('FROM SYSJOB.USER_JOBS')
    ? { success: true, data: [{ SCHEMA_NAME: 'APP', JOB_NAME: 42, ACTION: 'APP.REPORT;', REPEAT_INTERVAL: 'SYSDATE + 1', BROKEN: 'N' }] }
    : { success: false, message: 'Error -2106: 无效的表或视图名[USER_JOBS]' });
});

describe('Dameng legacy job definition catalog', () => {
  it('reads the legacy definition from SYSJOB with the owner and job ID preserved', async () => {
    const result = await loadDatabaseJobDefinition(connection, tab, t);
    expect(result.success).toBe(true);
    expect(result.definition).toContain('APP.REPORT;');
    expect(result.definition).toContain('SYSDATE + 1');
    expect(backend.query.mock.calls.every((call) => call[2].includes("SCHEMA_USER = 'APP' AND JOB = 42"))).toBe(true);
    expect(backend.query.mock.calls.every((call) => !call[2].includes('SYS.USER_JOBS'))).toBe(true);
  });

  it('uses the same corrected catalog when loading a management snapshot', async () => {
    const snapshot = await loadJobManagementSnapshot(
      { dialect: 'dm', kind: 'dbms-job', database: 'APP', owner: 'APP', name: '42' },
      (sql) => backend.query(connection.config, 'APP', sql),
    );
    expect(snapshot.job.ACTION).toBe('APP.REPORT;');
    expect(backend.query.mock.calls.every((call) => call[2].startsWith('SELECT '))).toBe(true);
  });
});
