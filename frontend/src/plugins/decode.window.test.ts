import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (window: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.window', name: 'Window', version: '1.0.0', permissions: [], window },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('plugin window bounds', () => {
  it('keeps a package-relative entry and rejects an oversized title, size, or parent path', () => {
    expect(decodeInspection(inspection({ entry: 'bin/plugin', title: '中'.repeat(85), width: 8192, height: 0 })).manifest.window?.entry).toBe('bin/plugin');
    expect(() => decodeInspection(inspection({ entry: 'bin/plugin', title: '中'.repeat(86) }))).toThrow();
    expect(() => decodeInspection(inspection({ entry: 'bin/plugin', width: 8193 }))).toThrow();
    expect(() => decodeInspection(inspection({ entry: '../plugin' }))).toThrow();
    expect(() => decodeInspection(inspection({ entry: 'bin/a<b' }))).toThrow();
    expect(() => decodeInspection(inspection({ entry: 'bin/a\tb' }))).toThrow();
  });
});
