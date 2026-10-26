import { describe, expect, it } from 'vitest';
import { freezeExportSnapshot } from './snapshot';
import { decodePluginExporters } from './decode';
import { parsePluginExporterFormat, isPluginExporterNamespace } from './identity';
import { goJSON } from './validation';
const format = 'plugin:sdk.examples.ndjson:ndjson';
describe('selected materialized exporter snapshot', () => {
  it('projects only chosen own keys, keeps order and freezes nested values without invoking unselected getters', () => {
    const row = { a: { text: 'original' }, b: null, big: '18446744073709551615', get secret() { throw new Error('must not read'); } };
    const snapshot = freezeExportSnapshot(format, [row], ['a', 'b', 'big', 'secret'], ['big', 'b', 'a']); row.a.text = 'changed';
    expect(snapshot.columns).toEqual(['big', 'b', 'a']); expect(snapshot.rows[0]).toEqual({ big: '18446744073709551615', b: null, a: { text: 'original' } });
    expect(Object.isFrozen(snapshot.rows[0].a)).toBe(true); expect(Object.isFrozen(snapshot.rows)).toBe(true);
  });
  it('preserves missing versus null, text NUL and preview strings without inferring types', () => {
    const snapshot = freezeExportSnapshot(format, [{ a: null, text: 'x\0y', bytes: 'AQID', date: '2026-10-20', preview: '[BLOB preview: 1/9 bytes] x' }], ['a', 'missing', 'text', 'bytes', 'date', 'preview']);
    expect(snapshot.rows[0]).not.toHaveProperty('missing'); expect(snapshot.rows[0].a).toBeNull(); expect(snapshot.rows[0].text).toBe('x\0y'); expect(snapshot.rows[0].bytes).toBe('AQID');
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, BigInt(1), new Date(), new Uint8Array([1]), () => 1, Symbol('x')])('rejects unsafe or unsupported values %s', (value) => {
    expect(() => freezeExportSnapshot(format, [{ value }], ['value'])).toThrow();
  });
  it('rejects cycles, sparse arrays, unsafe nested integers and selected accessors', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [cycle, Array(2), { bad: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => freezeExportSnapshot(format, [{ value }], ['value'])).toThrow();
    expect(() => freezeExportSnapshot(format, [{ get value() { throw new Error('must not invoke'); } }], ['value'])).toThrow();
  });
  it('accepts exactly 131072 logical nodes without counting JSON text twice', () => {
    const row = { a: Array(65529).fill(0), b: Array(65529).fill(0) };
    const snapshot = freezeExportSnapshot(format, [row], ['a', 'b']); expect((snapshot.rows[0].a as readonly number[]).length).toBe(65529);
    expect(() => freezeExportSnapshot(format, [{ a: Array(65530).fill(0), b: Array(65530).fill(0) }], ['a', 'b'])).toThrow();
  });
  it('keeps own __proto__, constructor and toString keys and rejects explicit undefined', () => {
    const row = JSON.parse('{"__proto__":{"constructor":"kept","toString":"also kept"},"constructor":null,"toString":"text"}');
    const snapshot = freezeExportSnapshot(format, [row], ['__proto__', 'constructor', 'toString']);
    expect(Object.getPrototypeOf(snapshot.rows[0])).toBeNull(); expect(snapshot.rows[0].__proto__).toEqual({ constructor: 'kept', toString: 'also kept' });
    expect(() => freezeExportSnapshot(format, [{ a: undefined }], ['a'])).toThrow();
  });
  it('fails whole exports on empty/duplicate/unknown columns, cell and envelope limits', () => {
    for (const selected of [[], ['a', 'a'], ['missing']]) expect(() => freezeExportSnapshot(format, [{ a: 1 }], ['a'], selected)).toThrow();
    expect(() => freezeExportSnapshot(format, Array(4097).fill({ a: 1 }), ['a'])).toThrow();
    expect(() => freezeExportSnapshot(format, [{ a: 'x'.repeat(128 * 1024 + 1) }], ['a'])).toThrow();
    expect(() => freezeExportSnapshot(format, [{ a: '<'.repeat(100000) }], ['a'])).toThrow();
    expect(goJSON({ a: '<>&' })).toBe('{"a":"\\u003c\\u003e\\u0026"}');
  });
  it.each(['\n', '\r\n', '\u2028', '\u2029'])('never accepts malformed identity ending %j', (ending) => { expect(parsePluginExporterFormat(format + ending)).toBeNull(); expect(isPluginExporterNamespace(format + ending)).toBe(true); });
  it('strictly decodes no-start metadata and rejects false availability or alias identities', () => {
    const entry = { format, pluginId: 'sdk.examples.ndjson', id: 'ndjson', name: 'NDJSON', extension: 'ndjson', contentType: 'application/x-ndjson', version: '1.0.0', digest: 'a'.repeat(64), generation: 1, available: true, state: 'running' };
    const data = decodePluginExporters({ items: [entry], truncated: true }); expect(data.truncated).toBe(true); expect(Object.isFrozen(data.items[0])).toBe(true);
    for (const patch of [{ extension: '.json' }, { contentType: 'application/json; charset=utf-8' }, { format: ' Plugin:sdk.examples.ndjson:ndjson' }, { generation: 0 }, { digest: entry.digest + '\n' }]) expect(() => decodePluginExporters({ items: [{ ...entry, ...patch }] })).toThrow();
  });
  it('lifts document caps only for declared streaming exporters', () => {
    const rows = Array.from({ length: 5000 }, (_, index) => ({ a: index }));
    expect(() => freezeExportSnapshot(format, rows, ['a'])).toThrow();
    const snapshot = freezeExportSnapshot(format, rows, ['a'], undefined, true);
    expect(snapshot.rows).toHaveLength(5000); expect(snapshot.rows[4999].a).toBe(4999);
    expect(() => freezeExportSnapshot(format, [{ a: 'x'.repeat(128 * 1024 + 1) }], ['a'], undefined, true)).toThrow();
    const heavy = Array.from({ length: 512 }, () => ({ a: 'x'.repeat(2000), b: 'y'.repeat(2000) }));
    expect(() => freezeExportSnapshot(format, heavy, ['a', 'b'], undefined, true)).toThrow();
  });
  it('decodes the optional streaming declaration without inventing one', () => {
    const base = { format, pluginId: 'sdk.examples.ndjson', id: 'ndjson', name: 'NDJSON', extension: 'ndjson', contentType: 'application/x-ndjson', version: '1.0.0', digest: 'a'.repeat(64), generation: 1, available: true, state: 'running' };
    expect(decodePluginExporters({ items: [base] }).items[0].streaming).toBe(false);
    expect(decodePluginExporters({ items: [{ ...base, streaming: true }] }).items[0].streaming).toBe(true);
    expect(() => decodePluginExporters({ items: [{ ...base, streaming: 'yes' }] })).toThrow();
  });
});
