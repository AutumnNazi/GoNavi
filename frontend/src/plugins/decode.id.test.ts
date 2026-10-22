import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (id: string, requires?: { id: string }[]) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id, name: 'Identity', version: '1.0.0', permissions: [], ...(requires ? { requires } : {}) },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('plugin ids', () => {
  it('requires a publisher and rejects aliases, trailing hyphens, self references, and 129 characters', () => {
    expect(decodeInspection(inspection('example.plugin')).manifest.id).toBe('example.plugin');
    expect(() => decodeInspection(inspection('Example.plugin'))).toThrow();
    expect(() => decodeInspection(inspection('example.plugin-'))).toThrow();
    expect(() => decodeInspection(inspection('example.' + 'a'.repeat(121)))).toThrow();
    expect(() => decodeInspection(inspection('example.host', [{ id: 'example.host' }]))).toThrow();
    expect(() => decodeInspection(inspection('example.host', [{ id: 'example.other' }, { id: 'example.other' }]))).toThrow();
  });
});
