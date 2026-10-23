import { PluginAPIError } from '../apiResult';
export const EXPORT_ENVELOPE_BYTES = 512 * 1024;
export const EXPORT_CELL_BYTES = 128 * 1024;
export const exporterError = (code: string): never => { throw new PluginAPIError('plugin.exporter.error.' + code); };
export function utf8Bytes(value: string): number {
  for (const character of value) { const point = character.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) return exporterError('snapshot'); }
  return new TextEncoder().encode(value).length;
}
export function exporterText(value: unknown, max: number, nonblank = true): value is string {
  if (typeof value !== 'string' || value.length > max || value.includes(String.fromCharCode(0))) return false;
  if (nonblank && !/[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(value)) return false;
  try { return utf8Bytes(value) <= max; } catch { return false; }
}
export const validExporterPin = (value: unknown): value is { digest: string; generation: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.digest === 'string' && record.digest.length === 64 && /^[a-f0-9]{64}$/.test(record.digest)
    && typeof record.generation === 'number' && Number.isSafeInteger(record.generation) && record.generation > 0;
};
export const goJSON = (value: unknown): string => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
