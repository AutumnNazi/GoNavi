import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (contributes: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.text', name: 'Text', version: '1.0.0', permissions: [], contributes },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('contribution names use UTF-8 bytes', () => {
  it('accepts 255 bytes and rejects 258 bytes for data sources, exporters, and models', () => {
    const exact = '中'.repeat(85);
    const over = '中'.repeat(86);
    const source = inspection({ commands: [{ id: 'database', title: 'Database', effect: 'read' }], dataSources: [{ id: 'fixture', name: exact, dialect: 'sqlite', command: 'database', readOnly: true }] });
    expect(decodeInspection(source).manifest.contributes?.dataSources?.[0].name).toBe(exact);
    expect(() => decodeInspection(inspection({ commands: [{ id: 'database', title: 'Database', effect: 'read' }], dataSources: [{ id: 'fixture', name: over, dialect: 'sqlite', command: 'database', readOnly: true }] }))).toThrow();
    expect(() => decodeInspection(inspection({ commands: [{ id: 'render', title: 'Render' }], exporters: [{ id: 'ndjson', name: over, command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' }] }))).toThrow();
    expect(() => decodeInspection(inspection({ commands: [{ id: 'generate', title: 'Generate' }], aiProviders: [{ id: 'chat', name: 'Chat', command: 'generate', supportsTools: true, supportsImages: false, models: [{ id: 'm', name: over, contextWindow: 4096, maxOutputTokens: 512 }] }] }))).toThrow();
  });
});
