import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobQueryResult } from '../../typeDefs/databaseJobTypes';
const backend = vi.hoisted(() => ({ query: vi.fn<(config: unknown, db: string, sql: string) => Promise<DatabaseJobQueryResult>>() }));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: backend.query }));
import { loadDatabaseJobs } from './sidebarDatabaseJobs';
import { buildRootDatabaseJobGroups } from './sidebarRootJobGroups';
import { openDatabaseJobDefinition } from './sidebarJobObjects';
import { supportsDatabaseEvents } from './sidebarMetadataBasics';
import { resolveExplorerFilterOrder } from './sidebarExplorerFilter';

const conn = (type: string): SavedConnection & { dbName: string } => ({
  id: 'conn', name: type, dbName: 'app', config: { type, host: 'localhost', database: 'app', port: 5432, user: 'app' },
});
beforeEach(() => { backend.query.mockReset(); });

describe('provider list and root object integration', () => {
  it('does not expose a misleading empty group when both PG plugins are absent', async () => {
    backend.query.mockResolvedValue({ success: true, data: [{ available: false }] });
    const result = await loadDatabaseJobs(conn('postgres'), 'app');
    expect(result).toEqual({ supported: false, jobs: [] });
    expect(buildRootDatabaseJobGroups(conn('postgres'), 'conn-app', result)).toEqual([]);
    expect(backend.query).toHaveBeenCalledTimes(2);
  });
  it('shows duplicate pg_cron labels as distinct jobs, with a stable tab ID and display label', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({ success: true, data: sql.includes('AS available')
      ? [{ available: sql.includes("'cron'") }]
      : [{ job_name: '1', job_label: 'daily' }, { job_name: '2', job_label: 'daily' }] }));
    const result = await loadDatabaseJobs(conn('postgres'), 'app');
    expect(result.supported).toBe(true);
    const groups = buildRootDatabaseJobGroups(conn('postgres'), 'conn-app', result);
    expect(groups).toHaveLength(1);
    const jobs = groups[0].children || [];
    expect(jobs.map((job) => job.title)).toEqual(['daily · 1 · pg_cron', 'daily · 2 · pg_cron']);
    const add = vi.fn<(tab: TabData) => void>();
    jobs.forEach((job) => openDatabaseJobDefinition(job, add));
    expect(add.mock.calls[0][0]).toMatchObject({ jobName: '1', jobLabel: 'daily', jobKind: 'pg-cron', schemaName: '' });
    expect(add.mock.calls[0][0].id).not.toBe(add.mock.calls[1][0].id);
  });
  it('reports an unreadable installed plugin without hiding the accessible provider', async () => {
    backend.query.mockImplementation(async (_config, _db, sql) => sql.includes('AS available')
      ? { success: true, data: [{ available: true }] }
      : sql.includes('cron.job') ? { success: false, message: 'permission denied' }
        : { success: true, data: [{ job_name: '10', job_label: 'agent' }] });
    const result = await loadDatabaseJobs(conn('postgres'), 'app');
    expect(result.jobs[0].jobKind).toBe('pgagent');
    expect(result.failureMessage).toContain('permission denied');
  });
  it.each(['kingbase', 'opengauss', 'gaussdb', 'doris', 'starrocks'])('places %s catalog objects outside schema groups', async (type) => {
    backend.query.mockImplementation(async (_config, _db, sql) => ({ success: true, data: sql.includes('AS available') ? [{ available: true }] : [{ job_name: '1', job_label: 'job' }] }));
    const result = await loadDatabaseJobs(conn(type), 'app');
    expect(result.supported).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(buildRootDatabaseJobGroups(conn(type), 'conn-app', result)[0].key).toBe('conn-app-jobs');
    expect(resolveExplorerFilterOrder('relational', conn(type))).toContain('jobs');
  });
  it('keeps MySQL/MariaDB in Events without duplicate job groups', async () => {
    for (const type of ['mysql', 'mariadb']) {
      expect(supportsDatabaseEvents(conn(type))).toBe(true);
      expect(await loadDatabaseJobs(conn(type), 'app')).toEqual({ jobs: [], supported: false });
      expect(resolveExplorerFilterOrder('relational', conn(type))).not.toContain('jobs');
    }
    expect(backend.query).not.toHaveBeenCalled();
  });
});
