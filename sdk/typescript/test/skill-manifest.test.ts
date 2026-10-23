import { describe, expect, it } from 'vitest';
import type { Manifest, Skill, SkillContent } from '../src/types.js';

describe('explicit packaged Skills declarations', () => {
  it('keeps static manifests free of execution and document body fields', () => {
    const skill: Skill = { id: 'guide', name: 'Guide', description: 'Read-only investigation', entry: 'skills/guide/SKILL.md' };
    const manifest: Manifest = { schemaVersion: 1, apiVersion: 1, id: 'example.skills', name: 'Skills', version: '1.0.0', permissions: ['ai.skills'], contributes: { skills: [skill] } };
    const raw = JSON.stringify(manifest);
    for (const field of ['backend', 'commands', 'content']) expect(raw).not.toContain('"' + field + '"');
    expect(JSON.parse(raw).contributes.skills).toEqual([skill]);
  });
  it('represents loaded text only as a provenance-bearing resource', () => {
    const resource: SkillContent = { pluginId: 'example.skills', skillId: 'guide', name: 'Guide', description: 'Description', version: '1.0.0', digest: 'a'.repeat(64), generation: 7, content: '# Opaque text' };
    expect(JSON.parse(JSON.stringify(resource))).toEqual(resource);
  });
});
