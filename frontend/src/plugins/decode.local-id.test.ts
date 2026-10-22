import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (commands: { id: string; title: string }[]) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.host', name: 'Host', version: '1.0.0', permissions: [],
    contributes: { commands } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('local contribution ids', () => {
  it('accepts a bounded local id and rejects aliases, duplicates, and 129 characters', () => {
    expect(decodeInspection(inspection([{ id: 'run.now_1-A', title: 'Run' }])).manifest.contributes?.commands?.[0].id).toBe('run.now_1-A');
    for (const id of ['-run', 'run/now', 'run now', 'a'.repeat(129)]) {
      expect(() => decodeInspection(inspection([{ id, title: 'Run' }]))).toThrow();
    }
    expect(() => decodeInspection(inspection([{ id: 'run', title: 'Run' }, { id: 'run', title: 'Again' }]))).toThrow();
  });
});
