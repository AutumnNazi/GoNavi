import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (extra: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.permissions', name: 'Permissions', version: '1.0.0', permissions: ['host.log'], ...extra },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('permission bounds', () => {
  it('matches the host count and note byte limit', () => {
    const permissions = Array.from({ length: 64 }, (_, index) => 'perm.' + index);
    expect(decodeInspection(inspection({ permissions })).manifest.permissions).toHaveLength(64);
    expect(() => decodeInspection(inspection({ permissions: [...permissions, 'extra'] }))).toThrow();
    const requires = Array.from({ length: 64 }, (_, index) => ({ id: 'example.dep' + index }));
    expect(decodeInspection(inspection({ requires })).manifest.requires).toHaveLength(64);
    expect(() => decodeInspection(inspection({ requires: [...requires, { id: 'example.extra' }] }))).toThrow();
    expect(decodeInspection(inspection({ permissionNotes: { 'host.log': '界'.repeat(53) } })).manifest.permissionNotes?.['host.log']).toHaveLength(53);
    expect(() => decodeInspection(inspection({ permissionNotes: { 'host.log': '界'.repeat(54) } }))).toThrow();
  });
});
