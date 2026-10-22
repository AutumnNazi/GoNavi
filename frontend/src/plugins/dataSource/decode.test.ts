import { describe, expect, it } from 'vitest';
import { decodePluginDataSources, MAX_PLUGIN_DATA_SOURCE_CATALOG_ITEMS } from './decode';
const item = { type: 'plugin:demo.source:reader:mysql', pluginId: 'demo.source', id: 'reader', name: 'Reader', dialect: 'mysql',
  defaultPort: 3306, version: '1.0.0', generation: 2, available: true, connectable: true, state: 'running', readOnly: true };
describe('validated plugin datasource catalog', () => {
  it('projects only allowed metadata without arbitrary capability or credential fields', () => {
    const values = decodePluginDataSources({ items: [{ ...item, ui: { editable: true }, password: 'not-public' }] });
    expect(values).toHaveLength(1); expect(values[0]).not.toHaveProperty('password'); expect(values[0]).not.toHaveProperty('ui');
    expect(decodePluginDataSources({ items: [{ ...item, defaultPort: undefined }] })[0].defaultPort).toBe(0);
  });
  it.each([{ type: 'mysql' }, { pluginId: 'other.source' }, { id: 'other' }, { dialect: 'postgres' }, { readOnly: 'no' },
    { state: ['running'], available: false }, { state: null }, { state: 'unknown' }, { defaultPort: null }, { defaultPort: -1 },
    { defaultPort: 65536 }, { reason: null }, { reason: [] }, { generation: Number.MAX_SAFE_INTEGER + 1 },
    { available: 'true' }, { connectable: 'true' }, { connectable: false }, { state: 'stopping' }])('rejects forged/malformed metadata %j', (patch) => {
    expect(() => decodePluginDataSources({ items: [{ ...item, ...patch }] })).toThrow();
  });
  it('keeps actual availability separate from eligibility', () => {
    const [starting] = decodePluginDataSources({ items: [{ ...item, available: false, connectable: true, state: 'starting', reason: 'starting' }] });
    expect(starting.available).toBe(false); expect(starting.connectable).toBe(true);
  });
  it('rejects duplicate contribution identities even with different dialects', () => {
    expect(() => decodePluginDataSources({ items: [item, { ...item, type: 'plugin:demo.source:reader:postgres', dialect: 'postgres' }] })).toThrow();
    expect(() => decodePluginDataSources({ items: Array.from({ length: 9 }, (_, n) => ({ ...item, type: 'plugin:demo.source:r' + n + ':mysql', id: 'r' + n })) })).toThrow();
  });
  it('supports large legitimate catalogs, with an explicit 4096-entry hard bound', () => {
    const many = Array.from({ length: 600 }, (_, n) => ({ ...item, type: 'plugin:p' + n + '.source:reader:mysql', pluginId: 'p' + n + '.source' }));
    expect(decodePluginDataSources({ items: many })).toHaveLength(600);
    expect(() => decodePluginDataSources({ items: new Array(MAX_PLUGIN_DATA_SOURCE_CATALOG_ITEMS + 1) })).toThrow();
    expect(() => decodePluginDataSources({ items: null })).toThrow();
  });
});
