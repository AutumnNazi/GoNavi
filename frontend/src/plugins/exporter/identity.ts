export interface PluginExporterIdentity { format: string; pluginId: string; id: string }
const trim = (text: string) => text.replace(/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '').trim();
export const isPluginExporterNamespace = (value: unknown): value is string => typeof value === 'string' && trim(trim(value).split(':', 1)[0]).toLowerCase() === 'plugin';
export function parsePluginExporterFormat(value: unknown): PluginExporterIdentity | null {
  if (typeof value !== 'string' || value.length > 199 || /[^a-z0-9:._-]/.test(value)) return null;
  const parts = value.split(':'); if (parts.length !== 3 || parts[0] !== 'plugin') return null;
  const [, pluginId, id] = parts;
  if (pluginId.length > 128 || !/^[a-z][a-z0-9-]*[.][a-z][a-z0-9.-]*$/.test(pluginId)
    || pluginId.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-')) || !/^[a-z][a-z0-9_.-]{0,63}$/.test(id)) return null;
  return { format: value, pluginId, id };
}
