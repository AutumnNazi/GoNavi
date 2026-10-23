import type { ExporterCell, ExporterRequest, ExporterResult, ExporterSnapshot } from './exportTypes.js';
import { EXPORTER_MAX_ENVELOPE_BYTES } from './exportTypes.js';
import { ExportJSONScanner, exportBytes, exportFault } from './exportJson.js';
import type { ExportBudget } from './exportJson.js';

const kinds = new Set(['missing', 'null', 'string', 'boolean', 'number', 'json', 'binary']);
const number = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const blank = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
export function exporterID(value: unknown): value is string {
 return typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
}
export function exportRecord(value: unknown): Record<string, unknown> {
 if (value === null || typeof value !== 'object' || Array.isArray(value)) exportFault();
 const prototype = Object.getPrototypeOf(value);
 if (prototype !== null && prototype !== Object.prototype) exportFault();
 const properties = Object.getOwnPropertyDescriptors(value);
 if (Object.getOwnPropertySymbols(value).length || Object.values(properties).some((property) => !('value' in property))) exportFault();
 return value as Record<string, unknown>;
}
function fields(value: unknown, expected: readonly string[]): Record<string, unknown> {
 const object = exportRecord(value); const names = Object.getOwnPropertyNames(object);
 if (names.length !== expected.length || names.some((key) => !expected.includes(key))) exportFault(); return object;
}
function array(value: unknown, maximum: number): unknown[] {
 if (!Array.isArray(value) || value.length > maximum) exportFault('limit_exceeded');
 if (Object.getPrototypeOf(value) !== Array.prototype) exportFault();
 const properties = Object.getOwnPropertyDescriptors(value);
 if (Object.getOwnPropertySymbols(value).length || Object.keys(properties).length !== value.length + 1 ||
  Object.entries(properties).some(([key, item]) => !('value' in item) || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) exportFault();
 return value;
}
function cell(value: unknown, budget: ExportBudget, replaceWireString = true): void {
 const object = exportRecord(value); const kind = object.kind;
 if (typeof kind !== 'string' || kind.length > 7 || !kinds.has(kind)) exportFault();
 if (kind === 'missing' || kind === 'null') { fields(object, ['kind']); return; }
 fields(object, ['kind', 'value']);
 if (typeof object.value !== 'string') exportFault(); exportBytes(object.value, 128 * 1024);
 if (kind === 'boolean' && object.value !== 'true' && object.value !== 'false') exportFault();
 if (kind === 'number' && (object.value.length > 256 || !number.test(object.value))) exportFault();
 if (kind === 'json') { if (replaceWireString) budget.nodes--; new ExportJSONScanner(object.value, budget).scan(4); }
 if (kind === 'binary') {
  try { if (btoa(atob(object.value)) !== object.value) exportFault(); } catch { exportFault(); }
 }
}

function preflight(input: unknown): ExporterRequest {
 const raw = exportRecord(input);
 const header = Object.getOwnPropertyNames(raw);
 const chunked = header.includes('chunkIndex') || header.includes('chunkCount');
 const object = fields(input, chunked
  ? ['protocolVersion', 'exporterId', 'columns', 'rows', 'chunkIndex', 'chunkCount']
  : ['protocolVersion', 'exporterId', 'columns', 'rows']);
 if (!exporterID(object.exporterId)) exportFault();
 if (chunked) {
  if (object.protocolVersion !== 2 || !Number.isSafeInteger(object.chunkCount) || !Number.isSafeInteger(object.chunkIndex)
   || (object.chunkCount as number) < 1 || (object.chunkCount as number) > 1 << 20
   || (object.chunkIndex as number) < 0 || (object.chunkIndex as number) >= (object.chunkCount as number)) exportFault();
 } else if (object.protocolVersion !== 1) exportFault();
 const columns = array(object.columns, 256); if (!columns.length) exportFault();
 const names = new Set<string>(); let size = 0;
 for (const name of columns) {
  if (typeof name !== 'string' || name.includes('\0') || blank.test(name) || names.has(name)) exportFault();
  size += exportBytes(name, 1024); names.add(name);
 }
 const rows = array(object.rows, chunked ? 512 : 4096); const budget = { nodes: 5 + columns.length + rows.length };
 if (rows.length * columns.length > (chunked ? 131072 : 16384)) exportFault('limit_exceeded');
 for (const row of rows) {
  const values = array(row, 256); if (values.length !== columns.length) exportFault();
  for (const value of values) {
   const record = exportRecord(value);
   if (typeof record.kind !== 'string' || record.kind.length > 7) exportFault(); size += record.kind.length;
   if ('value' in record) { if (typeof record.value !== 'string') exportFault(); size += exportBytes(record.value, 128 * 1024); }
   budget.nodes += 2 + ('value' in record && record.kind !== 'json' ? 1 : 0);
   if (size > EXPORTER_MAX_ENVELOPE_BYTES || budget.nodes > 131072) exportFault('limit_exceeded');
   cell(record, budget, false);
   fields(record, record.kind === 'missing' || record.kind === 'null' ? ['kind'] : ['kind', 'value']);
  }
 }
 return object as unknown as ExporterRequest;
}

/** Preserve raw numeric text in JSON cells. Do not JSON.parse/stringify their contents. */
export function validateExporterRequest(input: unknown, raw?: string): ExporterRequest {
 const request = preflight(input);
 const encoded = raw ?? JSON.stringify(request);
 exportBytes(encoded, EXPORTER_MAX_ENVELOPE_BYTES);
 const budget = { nodes: 0 }; const scanner = new ExportJSONScanner(encoded, budget); scanner.scan();
 if (scanner.versionToken !== String(request.protocolVersion)) exportFault();
 for (const row of request.rows) for (const value of row) cell(value, budget);
 return request;
}
export function parseExporterRequest(raw: string): ExporterRequest {
 exportBytes(raw, EXPORTER_MAX_ENVELOPE_BYTES); new ExportJSONScanner(raw, { nodes: 0 }).scan();
 let input: unknown; try { input = JSON.parse(raw); } catch { exportFault(); }
 return validateExporterRequest(input, raw);
}
export function copyExporterSnapshot(request: ExporterRequest): ExporterSnapshot {
 const chunk = request.protocolVersion === 2
  ? { protocolVersion: 2 as const, chunkIndex: request.chunkIndex, chunkCount: request.chunkCount }
  : {};
 return Object.freeze({ ...chunk, columns: Object.freeze([...request.columns]), rows: Object.freeze(request.rows.map((row) =>
  Object.freeze(row.map((value) => Object.freeze({ ...value }) as ExporterCell)))) });
}
export function exporterChunkResult(text: unknown, exporterId: string, chunkIndex: number, rowCount: number): ExporterResult {
 if (typeof text !== 'string' || text.includes('\0')) exportFault('invalid_result');
 exportBytes(text, EXPORTER_MAX_ENVELOPE_BYTES);
 const result: ExporterResult = { protocolVersion: 2, exporterId, chunkIndex, rowCount, text };
 exportBytes(JSON.stringify(result), EXPORTER_MAX_ENVELOPE_BYTES); return result;
}

export function exporterResult(text: unknown, rowCount: number): ExporterResult {
 if (typeof text !== 'string' || text.includes('\0') || (rowCount > 0 && text === '')) exportFault('invalid_result');
 exportBytes(text, EXPORTER_MAX_ENVELOPE_BYTES);
 const result: ExporterResult = { protocolVersion: 1, rowCount, text };
 exportBytes(JSON.stringify(result), EXPORTER_MAX_ENVELOPE_BYTES); return result;
}
