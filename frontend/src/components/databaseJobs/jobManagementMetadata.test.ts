import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../wailsjs/go/app/App', () => ({ DBQuery: vi.fn() }));
import { loadJobManagementSnapshot } from './jobManagementMetadata';
import type { JobTarget } from '../../utils/databaseJobs/jobManagementTypes';

const target: JobTarget = { dialect: 'postgres', kind: 'pgagent', database: 'app', owner: '', name: '7' };
describe('edit snapshot loading', () => {
  it('refuses partial steps instead of saving an incomplete edit', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ success: true, data: [{ job_name: '7' }] }).mockResolvedValue({ success: false, message: 'permission denied' });
    await expect(loadJobManagementSnapshot(target, execute)).rejects.toThrow('permission denied');
  });
  it('can read status without requiring step or schedule permissions', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: [{ job_name: '7' }] });
    expect(await loadJobManagementSnapshot(target, execute, false)).toEqual({ job: { job_name: '7' }, steps: [], schedules: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('loads all edit sections and never reads pgAgent connection secrets', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ success: true, data: [{ job_name: '7' }] }).mockResolvedValue({ success: true, data: [] });
    await loadJobManagementSnapshot(target, execute);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.map(c => c[0]).join('\n')).not.toContain('jstconnstr');
  });
  it('does not synthesize a missing job', async () => {
    await expect(loadJobManagementSnapshot(target, async () => ({ success: true, data: [] }))).rejects.toThrow('not_found');
  });
});
