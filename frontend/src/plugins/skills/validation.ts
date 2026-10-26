import { PluginAPIError } from '../apiResult';

export const MAX_SKILL_BODY_BYTES = 64 * 1024;
export const MAX_SKILL_CATALOG_ITEMS = 8192;
export function validSkillText(value: unknown, bytes: number, nonblank = true): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > bytes || value.includes(String.fromCharCode(0))) return false;
  if (nonblank && !/[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(value)) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return new TextEncoder().encode(value).length <= bytes;
}
export function validSkillPluginId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[a-z][a-z0-9-]*[.][a-z][a-z0-9.-]*$/.test(value)
    && value.split('.').every((part) => Boolean(part) && !part.startsWith('-') && !part.endsWith('-'));
}
export const validSkillId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
export const validSkillDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validSkillGeneration = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function validSkillEntry(value: unknown): value is string {
  if (!validSkillText(value, 1024) || value.includes('\\') || value.includes(':') || value.startsWith('/')) return false;
  const parts = value.split('/');
  if (parts.length > 33 || parts[parts.length - 1] !== 'SKILL.md') return false;
  return parts.every((part) => validSkillText(part, 240, false) && part !== '.' && part !== '..' && !part.endsWith(' ')
    && !part.endsWith('.') && !/[<>"|?*]/.test(part) && !/^(?:con|prn|aux|nul|clock[$]|conin[$]|conout[$]|com[0-9¹²³]|lpt[0-9¹²³])(?:[.]|$)/i.test(part)
    && [...part].every((character) => character.charCodeAt(0) >= 32));
}
export function validSkillResource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || new TextEncoder().encode(value).length > 1024 || value.includes('\\') || value.includes(':') || value.includes(String.fromCharCode(0)) || value.startsWith('/')) return false;
  const parts = value.split('/');
  const base = parts[parts.length - 1];
  if (parts.length > 33 || !base.endsWith('.md') || base === 'SKILL.md') return false;
  return parts.every((part) => validSkillText(part, 240, false) && part !== '.' && part !== '..' && !part.endsWith(' ')
    && !part.endsWith('.') && !/[<>"|?*]/.test(part) && !/^(?:con|prn|aux|nul|clock[$]|conin[$]|conout[$]|com[0-9¹²³]|lpt[0-9¹²³])(?:[.]|$)/i.test(part)
    && [...part].every((character) => character.charCodeAt(0) >= 32));
}
export const invalidSkillResponse = (): never => { throw new PluginAPIError('plugin.skills.error.invalid_response'); };
