import type { FrozenExportSnapshot, SnapshotValue } from './types';
import { EXPORT_CELL_BYTES, EXPORT_ENVELOPE_BYTES, exporterError, exporterText, goJSON, utf8Bytes } from './validation';
import { parsePluginExporterFormat } from './identity';
interface Budget { nodes: number; textBytes: number; stack: Set<object> }
interface WireCell { kind: 'missing' | 'null' | 'string' | 'number' | 'boolean' | 'json'; value?: string }
const plain = (value: object) => Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype;
function text(value: string, budget: Budget): string {
  if (value.length > EXPORT_CELL_BYTES) return exporterError('limit');
  const size = utf8Bytes(value); budget.textBytes += size;
  if (size > EXPORT_CELL_BYTES || budget.textBytes > EXPORT_ENVELOPE_BYTES) return exporterError('limit');
  return value;
}
function copyValue(value: unknown, budget: Budget, depth: number): SnapshotValue {
  if (++budget.nodes > 131072 || depth > 32) return exporterError('limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, budget);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return exporterError('unsafe_number');
    return value;
  }
  if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value))) return exporterError('snapshot');
  if (budget.stack.has(value)) return exporterError('snapshot'); budget.stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 131072 - budget.nodes) return exporterError('limit');
      const next: SnapshotValue[] = [];
      for (let index = 0; index < value.length; index++) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !('value' in item)) return exporterError('snapshot'); next.push(copyValue(item.value, budget, depth + 1)); }
      return Object.freeze(next);
    }
    const next: Record<string, SnapshotValue> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return exporterError('snapshot'); const item = Object.getOwnPropertyDescriptor(value, key)!;
      if (!item.enumerable) continue; if (!('value' in item)) return exporterError('snapshot');
      text(key, budget); next[key] = copyValue(item.value, budget, depth + 1);
    }
    return Object.freeze(next);
  } finally { budget.stack.delete(value); }
}
function cell(value: SnapshotValue | undefined): WireCell {
  if (value === undefined) return { kind: 'missing' };
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value: value ? 'true' : 'false' };
  if (typeof value === 'number') return { kind: 'number', value: JSON.stringify(value) };
  const encoded = goJSON(value); if (utf8Bytes(encoded) > EXPORT_CELL_BYTES) return exporterError('limit');
  return { kind: 'json', value: encoded };
}
export function snapshotColumns(source: readonly string[], selected?: readonly string[]): readonly string[] {
  if (!Array.isArray(source) || source.length > 4096) return exporterError('snapshot');
  const known = new Set<string>();
  for (const name of source) { if (!exporterText(name, 1024) || known.has(name)) return exporterError('snapshot'); known.add(name); }
  const columns = selected === undefined ? source : selected;
  if (!Array.isArray(columns) || !columns.length || columns.length > 256 || new Set(columns).size !== columns.length || columns.some((name) => !known.has(name))) return exporterError('snapshot');
  return Object.freeze([...columns]);
}
export function freezeExportSnapshot(format: string, data: readonly unknown[], sourceColumns: readonly string[], selected?: readonly string[], streaming = false): FrozenExportSnapshot {
  const identity = parsePluginExporterFormat(format); if (!identity) return exporterError('selection');
  const columns = snapshotColumns(sourceColumns, selected);
  if (!Array.isArray(data) || (!streaming && (data.length > 4096 || data.length * columns.length > 16384))) return exporterError('limit');
  const names = columns.reduce((sum, name) => sum + utf8Bytes(name), 0);
  const shared: Budget = { nodes: 5 + columns.length + data.length, textBytes: names, stack: new Set() };
  const rows: Readonly<Record<string, SnapshotValue>>[] = []; let wireRows: WireCell[][] = [];
  for (const source of data) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || !plain(source)) return exporterError('snapshot');
    const budget: Budget = streaming ? { nodes: 5 + columns.length, textBytes: names, stack: new Set() } : shared;
    const row: Record<string, SnapshotValue> = Object.create(null); const wire: WireCell[] = [];
    for (const column of columns) {
      const entry = Object.getOwnPropertyDescriptor(source, column);
      if (entry && !('value' in entry)) return exporterError('snapshot');
      if (entry && entry.value === undefined) return exporterError('snapshot');
      const value = !entry ? undefined : copyValue(entry.value, budget, 4);
      if (value !== undefined) row[column] = value;
      budget.nodes += 2; if (budget.nodes > 131072) return exporterError('limit'); wire.push(cell(value));
    }
    rows.push(Object.freeze(row)); wireRows.push(wire);
    if (streaming && wireRows.length === 512) {
      if (utf8Bytes(goJSON({ protocolVersion: 2, exporterId: identity.id, columns, chunkIndex: 0, chunkCount: 1, rows: wireRows })) > EXPORT_ENVELOPE_BYTES) return exporterError('limit');
      wireRows = [];
    }
  }
  if (streaming) {
    if (wireRows.length && utf8Bytes(goJSON({ protocolVersion: 2, exporterId: identity.id, columns, chunkIndex: 0, chunkCount: 1, rows: wireRows })) > EXPORT_ENVELOPE_BYTES) return exporterError('limit');
  } else if (utf8Bytes(goJSON({ protocolVersion: 1, exporterId: identity.id, columns, rows: wireRows })) > EXPORT_ENVELOPE_BYTES) return exporterError('limit');
  return Object.freeze({ columns, rows: Object.freeze(rows) });
}
