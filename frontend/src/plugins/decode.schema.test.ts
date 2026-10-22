import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (extra: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.schema', name: 'Schema', version: '1.0.0', permissions: [], ...extra },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('schema object bounds', () => {
  it('allows a 64 KiB object and rejects an array or one extra byte', () => {
    const exact = { k: 'a'.repeat(64 * 1024 - 8) };
    expect(decodeInspection(inspection({ configSchema: exact })).manifest.configSchema).toEqual(exact);
    expect(() => decodeInspection(inspection({ configSchema: { k: 'a'.repeat(64 * 1024 - 7) } }))).toThrow();
    expect(() => decodeInspection(inspection({ configSchema: [] }))).toThrow();
    expect(() => decodeInspection(inspection({ contributes: { commands: [{ id: 'run', title: 'Run', inputSchema: [] }] } }))).toThrow();
  });
});
