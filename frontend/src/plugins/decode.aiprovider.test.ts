import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (supportsImages: boolean = false) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.ai', name: 'AI', version: '1.0.0', permissions: ['ai.providers'],
    contributes: { commands: [{ id: 'generate', title: 'Generate' }], aiProviders: [{ id: 'chat', name: 'Chat', command: 'generate', supportsTools: true, supportsImages,
      models: [{ id: 'model', name: 'Model', contextWindow: 4096, maxOutputTokens: 512 }] }] } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('ai provider manifest decoding', () => {
  it('keeps declared text and image capabilities', () => {
    expect(decodeInspection(inspection()).manifest.contributes?.aiProviders?.[0].supportsImages).toBe(false);
    expect(decodeInspection(inspection(true)).manifest.contributes?.aiProviders?.[0].supportsImages).toBe(true);
  });
});
