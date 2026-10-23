import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (extension = 'ndjson', contentType = 'application/x-ndjson') => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.export', name: 'Export', version: '1.0.0', permissions: ['data.export'],
    contributes: { commands: [{ id: 'render', title: 'Render', effect: 'read' }],
      exporters: [{ id: 'ndjson', name: 'NDJSON', command: 'render', extension, contentType }] } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('exporter manifest decoding', () => {
  it('keeps a snapshot exporter and rejects a path or content-type parameter', () => {
    expect(decodeInspection(inspection()).manifest.contributes?.exporters?.[0].extension).toBe('ndjson');
    expect(() => decodeInspection(inspection('.ndjson'))).toThrow();
    expect(() => decodeInspection(inspection('ndjson', 'application/x-ndjson; charset=utf-8'))).toThrow();
  });
});
