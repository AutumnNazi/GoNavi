import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
import { boundedJSON, JSON_LIMITS } from './jsonBoundary';
const inspection = (description: string) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.identity', name: 'Identity', version: '1.0.0', permissions: [], description },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('manifest text boundary', () => {
  it('keeps the general cap and allows a host-sized plugin description', () => {
    expect(() => boundedJSON('a'.repeat(8193))).toThrow(/invalid_data/);
    expect(boundedJSON('a'.repeat(8193), JSON_LIMITS.bytes, 16384)).toBe('a'.repeat(8193));
    expect(decodeInspection(inspection('a'.repeat(8193))).manifest.description).toHaveLength(8193);
    expect(() => decodeInspection(inspection('a'.repeat(16385)))).toThrow();
  });
});
