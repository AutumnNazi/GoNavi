import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (description: string) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.commands', name: 'Commands', version: '1.0.0', permissions: [],
    contributes: { commands: [{ id: 'run', title: 'Run', description }] } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('command description bytes', () => {
  it('allows 4095 bytes and rejects 4098 bytes', () => {
    expect(decodeInspection(inspection('文'.repeat(1365))).manifest.contributes?.commands?.[0]).toMatchObject({ id: 'run' });
    expect(() => decodeInspection(inspection('文'.repeat(1366)))).toThrow();
  });
});
