import type { JSONValue } from './types.js';

export const EXPORTER_MAX_ENVELOPE_BYTES = 512 * 1024;
export const EXPORTER_CHUNK_ROWS = 512;
export type ExporterCell = { kind: 'missing' | 'null' } | {
 kind: 'string' | 'boolean' | 'number' | 'json' | 'binary'; value: string;
};
export type ExporterSnapshot = {
 readonly columns: readonly string[]; readonly rows: readonly (readonly ExporterCell[])[];
 readonly protocolVersion?: 2; readonly chunkIndex?: number; readonly chunkCount?: number;
};
export type ExporterRequest = { protocolVersion: 1 | 2; exporterId: string; columns: string[]; rows: ExporterCell[][]; chunkIndex?: number; chunkCount?: number };
export type ExporterResult = { protocolVersion: 1 | 2; exporterId?: string; chunkIndex?: number; rowCount: number; text: string };
/** Render only supplied data. Honor signal; never retain snapshots or perform destination work. */
export type ExporterRender = (snapshot: ExporterSnapshot, signal: AbortSignal) => string | Promise<string>;
export type ExporterHandlers = Readonly<Record<string, ExporterRender>>;
export type ExporterWireValue = JSONValue;
