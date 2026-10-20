import { describe, expect, it, vi } from 'vitest';
import type { SavedConnection } from '../../types';
import { executeJobManagement, isJobMutationRestricted } from './jobManagementExecution';

const connection: SavedConnection = { id: 'job-connection', name: 'Test', config: { type: 'postgres', host: 'localhost', port: 5432, user: 'tester' } };
const setup = () => ({ getConnection: vi.fn(() => connection), confirm: vi.fn(async () => true), execute: vi.fn(async () => ({ success: true })), validateFresh: vi.fn(async () => undefined) });

describe('job mutation safety boundary', () => {
  it.each(['restrictDataEdit', 'restrictStructureEdit', 'restrictScriptExecution', 'restrictDataImport'] as const)('blocks %s before asking for confirmation or sending SQL', async key => {
    const deps = setup();
    deps.getConnection.mockReturnValue({ ...connection, config: { ...connection.config, protection: { [key]: true } } });
    await expect(executeJobManagement('run', 'SELECT cron.alter_job(1)', deps)).rejects.toThrow('protected');
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });
  it('blocks legacy read-only mode and missing connections', () => {
    expect(isJobMutationRestricted(undefined)).toBe(true);
    expect(isJobMutationRestricted({ ...connection, config: { ...connection.config, readOnly: true } })).toBe(true);
  });
  it('does nothing when confirmation is cancelled', async () => {
    const deps = setup(); deps.confirm.mockResolvedValue(false);
    expect(await executeJobManagement('drop', 'SELECT cron.unschedule(1)', deps)).toBeNull();
    expect(deps.execute).not.toHaveBeenCalled(); expect(deps.validateFresh).not.toHaveBeenCalled();
  });
  it('re-resolves protection after confirmation', async () => {
    const deps = setup();
    deps.confirm.mockImplementation(async () => { deps.getConnection.mockReturnValue({ ...connection, config: { ...connection.config, readOnly: true } }); return true; });
    await expect(executeJobManagement('edit', 'UPDATE pgagent.pga_job SET jobenabled=false', deps)).rejects.toThrow();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects a changed destination after confirmation', async () => {
    const deps = setup();
    deps.confirm.mockImplementation(async () => { deps.getConnection.mockReturnValue({ ...connection, config: { ...connection.config, host: 'different-server' } }); return true; });
    await expect(executeJobManagement('edit', 'SELECT cron.alter_job(1)', deps)).rejects.toThrow('connection_changed');
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('does not send a stale edit', async () => {
    const deps = setup(); deps.validateFresh.mockRejectedValue(new Error('concurrent_change'));
    await expect(executeJobManagement('edit', 'SELECT cron.alter_job(1)', deps)).rejects.toThrow('concurrent_change');
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('queries history on a protected connection without mutation confirmation', async () => {
    const deps = setup(); deps.getConnection.mockReturnValue({ ...connection, config: { ...connection.config, readOnly: true } });
    expect(await executeJobManagement('history', 'SELECT * FROM cron.job_run_details', deps)).toEqual({ success: true });
    expect(deps.confirm).not.toHaveBeenCalled(); expect(deps.validateFresh).not.toHaveBeenCalled();
  });
  it.each(['', 'SELECT __GONAVI_JOB_ID__'])('rejects empty or unfilled SQL: %s', async sql => {
    const deps = setup(); await expect(executeJobManagement('edit', sql, deps)).rejects.toThrow('fill_placeholders'); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('never retries a failed or uncertain mutation', async () => {
    const deps = setup(); deps.execute.mockRejectedValue(new Error('connection lost'));
    await expect(executeJobManagement('run', 'CALL run_job()', deps)).rejects.toThrow('connection lost'); expect(deps.execute).toHaveBeenCalledTimes(1);
  });
});
