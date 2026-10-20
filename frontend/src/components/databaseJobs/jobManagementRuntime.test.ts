import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import type { JobCreateInput, JobSQLPlan, JobTarget } from '../../utils/databaseJobs/jobManagementTypes';
import type { JobManagementRequest } from './jobManagementRequest';

const mocks = vi.hoisted(() => ({
  connections: [] as SavedConnection[], query: vi.fn(), audited: vi.fn(), confirm: vi.fn(),
  production: vi.fn(), snapshot: vi.fn(), plan: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../../store', () => ({ useStore: { getState: () => ({ connections: mocks.connections }) } }));
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: mocks.query, DBQueryAudited: mocks.audited }));
vi.mock('../common/ResizableDraggableModal', () => ({ default: { confirm: mocks.confirm } }));
vi.mock('../../utils/productionRiskConfirm', () => ({ confirmProductionMutation: mocks.production }));
vi.mock('../../utils/sidebarDatabaseRefresh', () => ({ dispatchSidebarDatabaseRefresh: mocks.refresh }));
vi.mock('../../utils/databaseJobs/jobManagementPlans', () => ({ buildJobManagementPlan: mocks.plan }));
vi.mock('./jobManagementMetadata', () => ({ loadJobManagementSnapshot: mocks.snapshot, createJobMetadataExecutor: vi.fn() }));
import { submitJobSQL } from './jobManagementRuntime';

const request: JobManagementRequest = { connectionId: 'c', database: 'app', owner: '', name: '7', kind: 'pg-cron', operation: 'edit' };
const target: JobTarget = { dialect: 'postgres', kind: 'pg-cron', database: 'app', owner: '', name: '7' };
const input: JobCreateInput = { name: '', action: '', schedule: '', program: '', scheduleName: '', jobType: '' };
const plan: JobSQLPlan = { sql: 'SELECT cron.alter_job(7, active := TRUE)', readOnly: false };
type Confirmation = { onOk: () => void; onCancel: () => void };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connections = [{ id: 'c', name: 'Test', config: { type: 'postgres', host: 'localhost', port: 5432, user: 'tester' } }];
  mocks.query.mockResolvedValue({ success: true, data: [] });
  mocks.audited.mockResolvedValue({ success: true, data: [] });
  mocks.confirm.mockImplementation((options: Confirmation) => options.onOk());
  mocks.production.mockResolvedValue(true);
  mocks.snapshot.mockResolvedValue({ job: {}, steps: [], schedules: [] });
  mocks.plan.mockReturnValue(plan);
});

describe('native job management RPC integration', () => {
  it('routes edits through audited RPC after both confirmations and a fresh metadata check', async () => {
    const edited = 'SELECT cron.alter_job(7, active := FALSE)';
    const changed = vi.fn();
    expect(await submitJobSQL({ ...request, onChanged: changed }, target, 'edit', input, plan, edited)).toEqual({ success: true, data: [] });
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.production).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.audited).toHaveBeenCalledWith(expect.objectContaining({ type: 'postgres' }), 'app', edited, 'database_jobs');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith({ connectionId: 'c', dbName: 'app', schemaName: '', reason: 'external' });
    expect(changed).toHaveBeenCalledOnce();
  });
  it('does not ask production confirmation or write when ordinary confirmation is cancelled', async () => {
    mocks.confirm.mockImplementation((options: Confirmation) => options.onCancel());
    expect(await submitJobSQL(request, target, 'disable', input, plan, plan.sql)).toBeNull();
    expect(mocks.production).not.toHaveBeenCalled();
    expect(mocks.audited).not.toHaveBeenCalled();
  });
  it('does not mutate or refresh when production confirmation is cancelled', async () => {
    mocks.production.mockResolvedValue(false);
    expect(await submitJobSQL(request, target, 'disable', input, plan, plan.sql)).toBeNull();
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('rejects stale edit metadata before dispatch', async () => {
    mocks.plan.mockReturnValue({ ...plan, sql: 'different baseline' });
    await expect(submitJobSQL(request, target, 'edit', input, plan, plan.sql)).rejects.toThrow('concurrent_change');
    expect(mocks.audited).not.toHaveBeenCalled();
  });
  it('blocks edited read-only SQL instead of sending it through unconfirmed DBQuery', async () => {
    await expect(submitJobSQL(request, target, 'history', input, { sql: 'SELECT 1', readOnly: true }, 'DELETE FROM x')).rejects.toThrow('invalid_value');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.audited).not.toHaveBeenCalled();
  });
  it('reads history without asking mutation confirmation on a protected connection', async () => {
    mocks.connections[0].config.readOnly = true;
    await submitJobSQL(request, target, 'history', input, { sql: 'SELECT 1', readOnly: true }, 'SELECT 1');
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('does not reinterpret a successful write as failed when definition refresh fails', async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error('reload failed'));
    expect(await submitJobSQL({ ...request, onChanged }, target, 'disable', input, plan, plan.sql)).toEqual({ success: true, data: [] });
    expect(mocks.audited).toHaveBeenCalledOnce();
  });
  it('never retries a failed RPC or refreshes a failed write', async () => {
    mocks.audited.mockResolvedValue({ success: false, message: 'lost connection' });
    expect(await submitJobSQL(request, target, 'disable', input, plan, plan.sql)).toEqual({ success: false, message: 'lost connection' });
    expect(mocks.audited).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
