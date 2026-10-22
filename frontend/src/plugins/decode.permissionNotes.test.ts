import { describe, expect, it } from 'vitest';
import { PluginAPIError } from './apiResult';
import { decodeManifest } from './decode';

const base = { schemaVersion: 1, apiVersion: 1, id: 'example.notes', name: 'Notes', version: '1.0.0', permissions: ['host.log'] };

describe('permission note decoding', () => {
  it('keeps a note for a declared permission and rejects an undeclared one', () => {
    const manifest = decodeManifest({ ...base, permissionNotes: { 'host.log': 'Writes one diagnostic line' } });
    expect(manifest.permissionNotes?.['host.log']).toBe('Writes one diagnostic line');
    expect(() => decodeManifest({ ...base, permissionNotes: { 'data.export': 'export' } })).toThrow(PluginAPIError);
    expect(() => decodeManifest({ ...base, permissionNotes: { 'host.log': '<b>html</b>' } })).toThrow(PluginAPIError);
  });
});
