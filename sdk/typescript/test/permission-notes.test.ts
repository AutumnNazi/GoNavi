import { describe, expect, it } from 'vitest';
import type { Manifest } from '../src/types.js';
import { validatePermissionNotes } from '../src/permissionNotes.js';

const manifest: Manifest = {
  schemaVersion: 1, apiVersion: 1, id: 'example.notes', name: 'Notes', version: '1.0.0',
  permissions: ['host.log'], permissionNotes: { 'host.log': 'Writes one diagnostic line' },
};

describe('permission notes', () => {
  it('accepts a note for a declared permission and rejects the others', () => {
    expect(() => validatePermissionNotes(manifest)).not.toThrow();
    expect(() => validatePermissionNotes({ permissions: ['host.log'], permissionNotes: { 'data.export': 'export' } })).toThrow(/declared permission|invalid permission note/);
    expect(() => validatePermissionNotes({ permissions: ['host.log'], permissionNotes: { 'host.log': '<b>html</b>' } })).toThrow(/invalid permission note/);
    expect(() => validatePermissionNotes({ permissions: ['host.log'], permissionNotes: { 'host.log': '界'.repeat(53) } })).not.toThrow();
    expect(() => validatePermissionNotes({ permissions: ['host.log'], permissionNotes: { 'host.log': '界'.repeat(54) } })).toThrow(/invalid permission note/);
    expect(() => validatePermissionNotes({ permissions: [] })).not.toThrow();
  });
});
