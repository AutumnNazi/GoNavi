import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (contributes: Record<string, unknown>) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.counts', name: 'Counts', version: '1.0.0', permissions: [], contributes },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
const commands = (count: number) => Array.from({ length: count }, (_, index) => ({ id: 'cmd' + index, title: 'Run' }));
const panels = (count: number) => Array.from({ length: count }, (_, index) => ({ id: 'panel' + index, title: 'Panel', body: { type: 'text', text: 'Panel' } }));
describe('contribution counts', () => {
  it('allows 128 commands and 32 panels, and rejects one more', () => {
    expect(decodeInspection(inspection({ commands: commands(128), panels: panels(32) })).manifest.contributes?.commands).toHaveLength(128);
    expect(() => decodeInspection(inspection({ commands: commands(129) }))).toThrow();
    expect(() => decodeInspection(inspection({ panels: panels(33) }))).toThrow();
  });
});
