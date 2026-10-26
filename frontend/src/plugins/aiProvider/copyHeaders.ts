import { pluginProviderHeaders } from './configValidation';
// Mirrors the host's isSensitiveProviderHeader; HTTP names are ASCII tokens.
const sensitive = (name: string): boolean => name.toLowerCase().split(/[^a-z0-9]+/)
  .some((token) => ['auth', 'authorization', 'token', 'secret', 'key', 'apikey'].includes(token));
const nonblank = (value: string): boolean => /[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(value);
export const hasPluginProviderHeaderSecret = (headers?: Record<string, string>): boolean => Object.entries(headers ?? {}).some(([name, value]) => sensitive(name) && nonblank(value));
export function pluginProviderCopyHeaders(original: Record<string, string> | undefined, posted: Record<string, string> | undefined): Record<string, string> {
  if (posted === undefined) return pluginProviderHeaders(undefined, original);
  pluginProviderHeaders(undefined, posted);
  if (Object.keys(posted).length === 0) return {};
  const next: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(original ?? {})) if (sensitive(name)) next[name] = value;
  for (const [name, value] of Object.entries(posted)) {
    if (sensitive(name) && !nonblank(value)) continue;
    for (const old of Object.keys(next)) if (old.toLowerCase() === name.toLowerCase()) delete next[old];
    next[name] = value;
  }
  return pluginProviderHeaders(undefined, next);
}
