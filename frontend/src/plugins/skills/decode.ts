import { requireRecord, PluginAPIError } from '../apiResult';
import { MAX_SKILL_BODY_BYTES, MAX_SKILL_CATALOG_ITEMS, invalidSkillResponse, validSkillDigest, validSkillEntry,
  validSkillGeneration, validSkillId, validSkillPluginId, validSkillResource, validSkillText } from './validation';
import type { PackagedSkillContent, PackagedSkillDescriptor } from './types';

export function decodePackagedSkills(data: unknown): PackagedSkillDescriptor[] {
  const page = requireRecord(data);
  if (!Array.isArray(page.items) || page.items.length > MAX_SKILL_CATALOG_ITEMS) return invalidSkillResponse();
  const seen = new Set<string>(); const counts = new Map<string, number>();
  return page.items.map((value): PackagedSkillDescriptor => {
    const item = requireRecord(value);
    if (!validSkillPluginId(item.pluginId) || !validSkillId(item.id) || !validSkillText(item.name, 256)
      || !validSkillText(item.description, 2048) || !validSkillEntry(item.entry) || !validSkillText(item.version, 128)
      || !validSkillDigest(item.digest) || !validSkillGeneration(item.generation) || typeof item.available !== 'boolean'
      || (item.available && item.generation === 0) || (item.reason !== undefined && !validSkillText(item.reason, 256))
      || Object.prototype.hasOwnProperty.call(item, 'content') || Object.prototype.hasOwnProperty.call(item, 'systemPrompt')) return invalidSkillResponse();
    const key = item.pluginId + ':' + item.id; const count = (counts.get(item.pluginId) ?? 0) + 1;
    if (seen.has(key) || count > 16) return invalidSkillResponse();
    seen.add(key); counts.set(item.pluginId, count);
    return { pluginId: item.pluginId, id: item.id, name: item.name, description: item.description, entry: item.entry,
      resources: decodeSkillResources(item.resources), version: item.version, digest: item.digest, generation: item.generation, available: item.available, reason: item.reason as string | undefined };
  });
}
export function decodePackagedSkillContent(data: unknown, expected: PackagedSkillDescriptor): PackagedSkillContent {
  const item = requireRecord(data);
  if (!validSkillPluginId(item.pluginId) || !validSkillId(item.skillId) || !validSkillText(item.name, 256)
    || !validSkillText(item.description, 2048) || !validSkillText(item.version, 128) || !validSkillDigest(item.digest)
    || !validSkillGeneration(item.generation) || !validSkillText(item.content, MAX_SKILL_BODY_BYTES, false)) return invalidSkillResponse();
  if (!expected.available || expected.generation === 0 || item.pluginId !== expected.pluginId || item.skillId !== expected.id
    || item.digest !== expected.digest || item.generation !== expected.generation || item.version !== expected.version
    || item.name !== expected.name || item.description !== expected.description) throw new PluginAPIError('plugin.skills.error.stale');
  if (item.resource != null && (typeof item.resource !== 'string' || !expected.resources?.includes(item.resource))) return invalidSkillResponse();
  return { pluginId: item.pluginId, skillId: item.skillId, name: item.name, description: item.description,
    version: item.version, digest: item.digest, generation: item.generation, content: item.content, resource: typeof item.resource === 'string' ? item.resource : undefined };
}
function decodeSkillResources(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 4) return invalidSkillResponse();
  const seen = new Set<string>();
  for (const resource of value) {
    if (!validSkillResource(resource) || seen.has(resource)) return invalidSkillResponse();
    seen.add(resource);
  }
  return value as string[];
}

export const skillKey = (skill: PackagedSkillDescriptor) => skill.pluginId + ':' + skill.id;
export const skillSnapshotKey = (skill: PackagedSkillDescriptor) => JSON.stringify([skill.pluginId, skill.id, skill.digest, skill.generation, skill.version, skill.name, skill.description, skill.entry, skill.resources ?? [], skill.available]);
