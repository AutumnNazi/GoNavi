import { describe, expect, it } from 'vitest';
import type { DataSource, Manifest } from '../src/types.js';

describe('read-only data-source manifest types', () => {
  it('serializes the exact public source fields without optional panels', () => {
    const source: DataSource = { id: 'fixture', name: 'Read-only database', dialect: 'sqlite', command: 'database', readOnly: true };
    const manifest: Manifest = {
      schemaVersion: 1, apiVersion: 1, id: 'example.database', name: 'Database', version: '1.0.0', permissions: ['data.sources'],
      backend: { default: { executable: 'bin/database' } }, contributes: { commands: [{ id: 'database', title: 'Database' }], dataSources: [source] },
    };
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('panels');
    expect(serialized).not.toContain('defaultPort');
    expect(JSON.parse(serialized).contributes.dataSources).toEqual([source]);
  });

  it('keeps legacy manifests valid without datasource declarations', () => {
    const legacy: Manifest = { schemaVersion: 1, apiVersion: 1, id: 'example.legacy', name: 'Legacy', version: '1.0.0', permissions: [], contributes: {} };
    expect(JSON.stringify(legacy)).not.toContain('dataSources');
  });
});
