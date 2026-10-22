import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (version: string, minVersion?: string) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.host', name: 'Host', version, permissions: [],
    ...(minVersion == null ? {} : { requires: [{ id: 'example.other', minVersion }] }) },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('dependency versions', () => {
  it('accepts semantic versions and rejects shortened or v-prefixed ones', () => {
    expect(decodeInspection(inspection('1.2.3-rc.1+build.007', '1.2.3')).manifest.version).toBe('1.2.3-rc.1+build.007');
    for (const version of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3-', '1.2.3+']) {
      expect(() => decodeInspection(inspection(version))).toThrow();
      expect(() => decodeInspection(inspection('1.0.0', version))).toThrow();
    }
  });
});
