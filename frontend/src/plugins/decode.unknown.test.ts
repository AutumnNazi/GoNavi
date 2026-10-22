import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (extra: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.host', name: 'Host', version: '1.0.0', permissions: [], ...extra },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('unknown manifest fields', () => {
  it('rejects a long unknown field without echoing its name', () => {
    const name = '文'.repeat(80);
    expect(() => decodeInspection(inspection({ [name]: 1 }))).toThrowError(expect.objectContaining({ message: 'plugin.error.invalid_response' }));
    try { decodeInspection(inspection({ [name]: 1 })); } catch (error) {
      expect(String(error)).not.toContain('文文文');
    }
    expect(() => decodeInspection(inspection({ contributes: { commands: [{ id: 'run', title: 'Run', [name]: true }] } }))).toThrow('plugin.error.invalid_response');
    expect(() => decodeInspection(inspection({ window: { entry: 'bin/plugin', [name]: true } }))).toThrow('plugin.error.invalid_response');
    expect(() => decodeInspection(inspection({ backend: { default: { executable: 'bin/plugin', [name]: true } } }))).toThrow('plugin.error.invalid_response');
    expect(() => decodeInspection(inspection({ contributes: { panels: [{ id: 'main', title: 'Panel', body: { type: 'text', text: 'ok', [name]: true } }] } }))).toThrow('plugin.error.invalid_response');
    expect(() => decodeInspection(inspection({ contributes: { commands: [{ id: 'ask', title: 'Ask' }], aiProviders: [{ id: 'chat', name: 'Chat', command: 'ask', supportsTools: false, supportsImages: false, models: [{ id: 'm', name: 'M', contextWindow: 1024, maxOutputTokens: 1, [name]: true }] }] } }))).toThrow('plugin.error.invalid_response');
  });
});
