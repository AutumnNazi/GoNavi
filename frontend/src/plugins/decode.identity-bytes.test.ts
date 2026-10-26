import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (name: string, extra: Record<string, unknown> = {}) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.identity', name, version: '1.0.0', permissions: [], ...extra },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('plugin identity byte limits', () => {
  it('counts the plugin name, description, and command title in UTF-8 bytes', () => {
    expect(decodeInspection(inspection('中'.repeat(85))).manifest.name).toHaveLength(85);
    expect(() => decodeInspection(inspection('中'.repeat(86)))).toThrow();
    expect(() => decodeInspection(inspection('Plugin', { description: '文'.repeat(5462) }))).toThrow();
    expect(() => decodeInspection(inspection('Plugin', { contributes: { commands: [{ id: 'run', title: '中'.repeat(86) }] } }))).toThrow();
  });
});
