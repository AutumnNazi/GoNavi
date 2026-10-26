import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (effect: string, dataSource = false) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.host', name: 'Host', version: '1.0.0', permissions: [],
    contributes: {
      commands: [{ id: 'query', title: 'Query', effect }],
      ...(dataSource ? { dataSources: [{ id: 'db', name: 'DB', command: 'query', readOnly: true, dialect: 'sqlite' }] } : {}),
    } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('command effects', () => {
  it('allows write on a command and still rejects it for a data source', () => {
    expect(decodeInspection(inspection('write')).manifest.contributes?.commands?.[0]).toMatchObject({ effect: 'write' });
    expect(() => decodeInspection(inspection('WRITE'))).toThrow();
    expect(() => decodeInspection(inspection('sideeffect'))).toThrow();
    expect(() => decodeInspection(inspection('write', true))).toThrow();
  });
});
