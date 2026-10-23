import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginList: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
import { pluginAPI } from './api';
beforeEach(() => vi.resetAllMocks());

// A lifecycle failure has to reach the user as its own message; the generic fallback would hide
// whether the plugin is disabled, changed on disk, missing, or still settling.
describe('lifecycle failure codes', () => {
  it.each(['plugin_disabled', 'digest_mismatch', 'not_found', 'plugin_busy'])("maps %s to its own message", async (code) => {
    host.PluginList.mockResolvedValue({ success: false, message: 'host text', data: { code } });
    await expect(pluginAPI.list()).rejects.toThrow(`plugin.backend.error.${code}`);
  });
  it('still falls back for a code the UI does not know', async () => {
    host.PluginList.mockResolvedValue({ success: false, message: 'host text', data: { code: 'unknown_future_code' } });
    await expect(pluginAPI.list()).rejects.toThrow('plugin.backend.error.operation_failed');
  });
});
