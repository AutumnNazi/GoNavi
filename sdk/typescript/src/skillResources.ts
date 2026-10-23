export function validateSkillResources(skill: { entry: string; resources?: readonly string[] }): void {
  if (!plainSkillEntry(skill.entry)) throw new Error('invalid skill entry');
  const resources = skill.resources ?? [];
  if (resources.length > 4) throw new Error('too many skill resources');
  const seen = new Set<string>([skill.entry]);
  for (const resource of resources) {
    if (seen.has(resource) || !plainSkillResource(resource)) throw new Error('invalid skill resource');
    seen.add(resource);
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function reservedSkillSegment(part: string): boolean {
  const base = part.split('.')[0].toUpperCase();
  if (['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', 'CONIN$', 'CONOUT$'].includes(base)) return true;
  if (!base.startsWith('COM') && !base.startsWith('LPT')) return false;
  const suffix = base.slice(3);
  return suffix.length === 1 && suffix >= '0' && suffix <= '9' || suffix === '¹' || suffix === '²' || suffix === '³';
}

function skillPathForbidden(value: string): boolean {
  return /[\\:\u0000-\u001f<>"|?*]/.test(value);
}
function plainSkillEntry(entry: string): boolean {
  if (entry.length === 0 || utf8Bytes(entry) > 1024 || entry.includes('..') || skillPathForbidden(entry) || entry.startsWith('/')) return false;
  const parts = entry.split('/');
  if (parts.length > 33 || parts.some((part) => part === '' || part === '.' || part === '..' || utf8Bytes(part) > 240 || part.endsWith(' ') || part.endsWith('.') || reservedSkillSegment(part))) return false;
  return parts[parts.length - 1] === 'SKILL.md';
}

function plainSkillResource(resource: string): boolean {
  if (resource.length === 0 || utf8Bytes(resource) > 1024 || resource.includes('..') || skillPathForbidden(resource)) return false;
  const parts = resource.split('/');
  return resource.endsWith('.md') && !resource.endsWith('SKILL.md') && !resource.startsWith('/') && parts.length <= 33 && parts.every((part) => utf8Bytes(part) <= 240 && !part.endsWith(' ') && !part.endsWith('.') && !reservedSkillSegment(part));
}
