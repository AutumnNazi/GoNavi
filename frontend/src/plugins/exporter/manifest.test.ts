import { describe, expect, it } from 'vitest';
import { decodeInspection, decodeStatus } from '../decode';
import { publicPluginCommands } from '../dataSource/reservedCommands';
const manifest = { schemaVersion: 1, apiVersion: 1, id: 'sdk.example', name: 'Example', version: '1.0.0', permissions: ['data.export'], backend: { default: { executable: 'bin/plugin' } }, contributes: {
  commands: [{ id: 'ordinary', title: 'Ordinary' }, { id: 'render', title: 'Render' }, { id: 'database', title: 'Database' }, { id: 'model', title: 'Model' }],
  exporters: [{ id: 'ndjson', name: 'NDJSON', command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' }], dataSources: [{ id: 'fixture', name: 'Fixture', dialect: 'sqlite', command: 'database', readOnly: true }], aiProviders: [{ id: 'chat', name: 'Chat', command: 'model', supportsTools: true, supportsImages: false, models: [{ id: 'm', name: 'M', contextWindow: 4096, maxOutputTokens: 512 }] }],
} };
describe('plugin manager exporter metadata and reserved command compatibility', () => {
  it('preserves exporter declarations in installed status and inspection preview', () => {
    const status = decodeStatus({ manifest, state: 'running', desiredEnabled: true, digest: 'a'.repeat(64), generation: 1, installedAt: '2026-10-20' });
    const inspected = decodeInspection({ manifest, digest: 'a'.repeat(64), sourcePath: 'fixture.zip', sizeBytes: 100 });
    expect(status.manifest.contributes).toHaveProperty('exporters', manifest.contributes.exporters); expect(inspected.manifest.contributes).toHaveProperty('exporters', manifest.contributes.exporters);
    expect(publicPluginCommands(status.manifest).map((command) => command.id)).toEqual(['ordinary']);
  });
  it('fails closed for malformed exporter references while leaving ordinary commands unchanged when omitted', () => {
    expect(() => decodeInspection({ manifest: { ...manifest, contributes: { ...manifest.contributes, exporters: [{ command: 'render\n' }] } }, digest: 'a'.repeat(64), sourcePath: 'fixture.zip', sizeBytes: 100 })).toThrow();
    const old = decodeInspection({ manifest: { ...manifest, contributes: { commands: manifest.contributes.commands } }, digest: 'a'.repeat(64), sourcePath: 'fixture.zip', sizeBytes: 100 });
    expect(publicPluginCommands(old.manifest)).toHaveLength(4);
  });
});
