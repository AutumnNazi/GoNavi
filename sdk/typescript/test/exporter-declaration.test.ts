import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateExporter } from '../src/exporterDeclaration.js';
import type { Manifest } from '../src/types.js';
describe('exporter declaration', () => {
  it('accepts the shipped snapshot exporter and rejects a path or parameters', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../examples/plugins/ndjson-exporter/gonavi.plugin.json', import.meta.url), 'utf8')) as Manifest;
    const exporter = manifest.contributes?.exporters?.[0];
    expect(exporter?.extension).toBe('ndjson');
    expect(() => validateExporter(exporter ?? { id: '', name: '', command: '', extension: '', contentType: '' })).not.toThrow();
    expect(() => validateExporter({ ...(exporter ?? { id: 'ndjson', name: 'NDJSON', command: 'render', contentType: 'application/x-ndjson' }), extension: '../ndjson' })).toThrow(/extension/);
    const base = exporter ?? { id: 'ndjson', name: 'NDJSON', command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' };
    expect(() => validateExporter({ ...base, name: '中'.repeat(85) })).not.toThrow();
    expect(() => validateExporter({ ...base, name: '中'.repeat(86) })).toThrow(/identity/);
  });
});
