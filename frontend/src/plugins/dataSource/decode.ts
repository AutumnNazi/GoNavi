import { PluginAPIError, requireRecord } from '../apiResult';
import { parsePluginDataSourceType } from './identity';
import type { PluginDataSourceDescriptor } from './types';

export const MAX_PLUGIN_DATA_SOURCE_CATALOG_ITEMS = 4096;
const invalid = (): never => { throw new PluginAPIError('plugin.datasource.error.invalid_catalog'); };
const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !value.includes(String.fromCharCode(0));
export function decodePluginDataSources(data: unknown): PluginDataSourceDescriptor[] {
  const page = requireRecord(data);
  if (!Array.isArray(page.items) || page.items.length > MAX_PLUGIN_DATA_SOURCE_CATALOG_ITEMS) return invalid();
  const ids = new Set<string>();
  const perPlugin = new Map<string, number>();
  return page.items.map((value): PluginDataSourceDescriptor => {
    const item = requireRecord(value);
    const identity = parsePluginDataSourceType(item.type);
    if (!identity || item.pluginId !== identity.pluginId || item.id !== identity.id || item.dialect !== identity.dialect
      || typeof item.readOnly !== 'boolean' || typeof item.available !== 'boolean' || typeof item.connectable !== 'boolean'
      || typeof item.state !== 'string' || !['disabled', 'starting', 'running', 'stopping', 'faulted', 'blocked'].includes(item.state)
      || (item.available && (!item.connectable || item.state !== 'running'))
      || (item.connectable && ['stopping', 'faulted', 'blocked'].includes(String(item.state))) || !text(item.name, 256) || !text(item.version, 128)
      || typeof item.generation !== 'number' || !Number.isSafeInteger(item.generation) || item.generation < 0
      || (item.defaultPort !== undefined && (!Number.isInteger(item.defaultPort) || Number(item.defaultPort) < 0 || Number(item.defaultPort) > 65535))
      || (item.reason !== undefined && !text(item.reason, 256)) || ids.has(identity.pluginId + ':' + identity.id)) return invalid();
    const count = (perPlugin.get(identity.pluginId) ?? 0) + 1;
    if (count > 8) return invalid();
    perPlugin.set(identity.pluginId, count); ids.add(identity.pluginId + ':' + identity.id);
    return { ...identity, name: item.name as string, defaultPort: Number(item.defaultPort ?? 0), version: item.version as string,
      generation: item.generation, available: item.available, connectable: item.connectable, state: item.state as PluginDataSourceDescriptor['state'], readOnly: item.readOnly, reason: item.reason as string | undefined };
  });
}
