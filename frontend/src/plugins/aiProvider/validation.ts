import { PluginAPIError } from '../apiResult';
export function pluginAIText(value: unknown, maxBytes: number, nonblank = true): value is string {
  if (typeof value !== 'string' || value.length > maxBytes || value.includes(String.fromCharCode(0))) return false;
  if (nonblank && !/[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(value)) return false;
  for (const character of value) { const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return false; }
  return new TextEncoder().encode(value).length <= maxBytes;
}
export const isPluginModelId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/@+\-]{0,127}$(?![\s\S])/.test(value);
export const invalidPluginAICatalog = (): never => { throw new PluginAPIError('plugin.ai_provider.error.invalid_catalog'); };
