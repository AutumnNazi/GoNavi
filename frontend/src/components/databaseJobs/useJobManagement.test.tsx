import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
const state = vi.hoisted(() => ({ connections: [] as SavedConnection[] }));
const api = vi.hoisted(() => ({ query: vi.fn(), submit: vi.fn() }));
vi.mock('../../store', () => ({ useStore: (selector: (s: typeof state) => unknown) => selector(state) }));
vi.mock('./jobManagementRuntime', () => ({ submitJobSQL: api.submit }));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: api.query }));
import { useJobManagement } from './useJobManagement';
import type { JobManagementRequest } from './jobManagementRequest';

const request: JobManagementRequest = { connectionId: 'conn', database: 'app', owner: '', name: '7', kind: 'pg-cron', operation: 'edit' };
let current: ReturnType<typeof useJobManagement>;
const Harness = ({ value = request }: { value?: JobManagementRequest }) => { current = useJobManagement(value); return <div />; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
  state.connections = [{ id: 'conn', name: 'Test', config: { type: 'postgres', host: 'localhost', port: 5432, user: 'tester' } }];
  api.query.mockReset(); api.submit.mockReset();
  api.query.mockResolvedValue({ success: true, data: [{ job_name: '7', job_label: 'nightly', action: 'SELECT 1', repeat_interval: '0 0 * * *', database_name: 'app' }] });
});

describe('job management UI state', () => {
  it('loads native edit SQL without executing it on open', async () => {
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(<Harness />); await flush(); });
    expect(current.sql).toContain('cron.alter_job');
    expect(api.submit).not.toHaveBeenCalled();
    await act(async () => tree!.unmount());
  });
  it('guards double submit immediately and consumes a successful plan', async () => {
    let tree: ReactTestRenderer; let resolve: (value: { success: boolean }) => void = () => undefined;
    api.submit.mockImplementation(() => new Promise(done => { resolve = done; }));
    await act(async () => { tree = create(<Harness />); await flush(); });
    await act(async () => { void current.submit(); void current.submit(); await flush(); });
    expect(api.submit).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ success: true }); await flush(); });
    expect(current.plan).toBeNull();
    await act(async () => { await current.submit(); });
    expect(api.submit).toHaveBeenCalledTimes(1);
    await act(async () => tree!.unmount());
  });
  it('starts creation with no executable plan until inputs are validated', async () => {
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(<Harness value={{ ...request, operation: 'create', name: '' }} />); await flush(); });
    expect(current.plan).toBeNull(); expect(api.query).not.toHaveBeenCalled();
    await act(async () => { await current.load(); });
    expect(current.plan).toBeNull(); expect(current.error).not.toBe('');
    await act(async () => tree!.unmount());
  });
  it('checks actual StarRocks version before exposing ALTER TASK', async () => {
    state.connections[0].config.type = 'starrocks';
    api.query.mockImplementation(async (_c: unknown, _d: string, sql: string) => ({ success: true, data: sql.includes('current_version') ? [{ version: '4.0.9' }] : [{ job_name: 'task1' }] }));
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(<Harness value={{ ...request, kind: 'starrocks-task', name: 'task1', operation: 'status' }} />); await flush(); });
    expect(current.unavailable('edit')).toBe('database_jobs.manage.starrocks_version');
    expect(current.unavailable('history')).toBe('');
    await act(async () => tree!.unmount());
  });
});
