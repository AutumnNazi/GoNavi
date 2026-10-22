import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDataSource, validateDataSourceCommand } from '../src/datasourceValidation.js';
import type { Manifest } from '../src/types.js';

describe('data source declaration', () => {
  it('accepts explicit read-only and writable sqlite declarations', () => {
    const source = { id: 'fixture', name: 'Fixture', dialect: 'sqlite', readOnly: true };
    expect(() => validateDataSource(source)).not.toThrow();
    expect(() => validateDataSource({ ...source, readOnly: false })).not.toThrow();
    expect(() => validateDataSource({ ...source, readOnly: 'yes' as unknown as boolean })).toThrow(/explicitly/);
    expect(() => validateDataSource({ ...source, dialect: 'oracle' })).toThrow(/dialect/);
    expect(() => validateDataSource({ ...source, id: 'Fixture' })).toThrow(/identity/);
    expect(() => validateDataSource({ ...source, name: '中'.repeat(85) })).not.toThrow();
    expect(() => validateDataSource({ ...source, name: '中'.repeat(86) })).toThrow(/identity/);
  });

  it('accepts the shipped read-only example declaration', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../examples/plugins/read-only-database/gonavi.plugin.json', import.meta.url), 'utf8')) as Manifest;
    const source = manifest.contributes?.dataSources?.[0];
    expect(source?.dialect).toBe('sqlite');
    expect(source?.readOnly).toBe(true);
    const command = manifest.contributes?.commands?.find((item) => item.id === source?.command);
    expect(command?.effect).toBe('read');
    expect(() => validateDataSourceCommand(source ?? { id: '', name: '', dialect: '', readOnly: false, command: '' }, command ?? { id: '' })).not.toThrow();
    const declared = { id: 'fixture', name: 'Fixture', dialect: 'sqlite', readOnly: true, command: 'database' };
    expect(() => validateDataSourceCommand(declared, { id: 'database', effect: 'write' })).toThrow(/read or unknown/);
    expect(() => validateDataSourceCommand(declared, { id: 'database', effect: 'WRITE' })).toThrow(/read or unknown/);
    expect(() => validateDataSourceCommand({ ...declared, readOnly: false }, { id: 'database', effect: 'write' })).not.toThrow();
  });
});
