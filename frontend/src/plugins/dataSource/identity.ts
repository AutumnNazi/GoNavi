export type PluginSQLDialect = 'mysql' | 'postgres' | 'sqlite';
export type PluginDataSourceType = `plugin:${string}:${string}:${PluginSQLDialect}`;
export interface PluginDataSourceIdentity { type: string; pluginId: string; id: string; dialect: PluginSQLDialect }

// Broader than the parser on purpose: malformed reserved identities still fail closed.
export const isPluginDataSourceNamespace = (value: unknown): value is string =>
  typeof value === 'string' && (value.trim().toLowerCase() === 'plugin' || value.trim().toLowerCase().startsWith('plugin:'));

export function parsePluginDataSourceType(value: unknown): PluginDataSourceIdentity | null {
  if (typeof value !== 'string' || value.length > 210) return null;
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'plugin') return null;
  const [, pluginId, id, dialect] = parts;
  if (pluginId.length > 128 || !/^[a-z][a-z0-9-]*[.][a-z][a-z0-9.-]*$/.test(pluginId)
    || pluginId.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-'))
    || !/^[a-z][a-z0-9_.-]{0,63}$/.test(id) || !['mysql', 'postgres', 'sqlite'].includes(dialect)) return null;
  return { type: value, pluginId, id, dialect: dialect as PluginSQLDialect };
}
export function pluginDataSourceConfigType(config: { type?: unknown; driver?: unknown } | null | undefined): string | null {
  if (isPluginDataSourceNamespace(config?.type)) return config.type;
  if (String(config?.type ?? '').trim().toLowerCase() === 'custom' && isPluginDataSourceNamespace(config?.driver)) return config.driver;
  return null;
}
