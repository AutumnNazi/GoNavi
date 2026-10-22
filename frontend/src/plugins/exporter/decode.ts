import { isRecord } from '../jsonBoundary';
import { parsePluginExporterFormat } from './identity';
import { exporterError, exporterText, utf8Bytes } from './validation';
import type { PluginExporterCatalog, PluginExporterDescriptor } from './types';
export function decodePluginExporters(data: unknown): PluginExporterCatalog {
  if (!isRecord(data) || !Array.isArray(data.items) || data.items.length > 256 || (data.truncated !== undefined && typeof data.truncated !== 'boolean')) return exporterError('catalog');
  const keys = new Set<string>(); const counts = new Map<string, number>();
  const items = data.items.map((raw): PluginExporterDescriptor => {
    if (!isRecord(raw)) return exporterError('catalog'); const identity = parsePluginExporterFormat(raw.format);
    if (!identity || raw.pluginId !== identity.pluginId || raw.id !== identity.id || !exporterText(raw.name, 256) || !exporterText(raw.version, 128)
      || typeof raw.extension !== 'string' || !/^[a-z0-9]{1,16}$(?![\s\S])/.test(raw.extension)
      || typeof raw.contentType !== 'string' || !/^(text|application)\/[a-z0-9][a-z0-9.+-]{0,63}$(?![\s\S])/.test(raw.contentType)
      || typeof raw.digest !== 'string' || raw.digest.length !== 64 || !/^[a-f0-9]{64}$/.test(raw.digest)
      || typeof raw.generation !== 'number' || !Number.isSafeInteger(raw.generation) || raw.generation < 0 || typeof raw.available !== 'boolean'
      || typeof raw.state !== 'string' || !['disabled', 'starting', 'running', 'stopping', 'faulted', 'blocked'].includes(raw.state)
      || (raw.available && (raw.generation === 0 || raw.state !== 'running')) || (raw.streaming !== undefined && typeof raw.streaming !== 'boolean')
      || (raw.reason !== undefined && !exporterText(raw.reason, 256))) return exporterError('catalog');
    const count = (counts.get(identity.pluginId) ?? 0) + 1;
    if (keys.has(identity.format) || count > 8) return exporterError('catalog'); keys.add(identity.format); counts.set(identity.pluginId, count);
    return Object.freeze({ ...identity, name: raw.name, extension: raw.extension, contentType: raw.contentType, streaming: raw.streaming === true, version: raw.version,
      digest: raw.digest, generation: raw.generation, available: raw.available, state: raw.state as PluginExporterDescriptor['state'], reason: raw.reason as string | undefined });
  });
  if (utf8Bytes(JSON.stringify(data)) > 256 * 1024) return exporterError('catalog');
  return Object.freeze({ items: Object.freeze(items), truncated: data.truncated === true });
}
export const exporterSnapshotKey = (item: PluginExporterDescriptor | undefined): string => item ? JSON.stringify(item) : '';
