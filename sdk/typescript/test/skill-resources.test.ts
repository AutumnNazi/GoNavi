import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateSkillResources } from '../src/skillResources.js';
import type { Manifest } from '../src/types.js';

describe('skill resources', () => {
  it('accepts a companion markdown path and rejects scripts or the entry', () => {
    expect(() => validateSkillResources({ entry: 'skills/guide/SKILL.md', resources: ['skills/guide/REFERENCE.md'] })).not.toThrow();
    expect(() => validateSkillResources({ entry: 'SKILL.md', resources: ['a'.repeat(237) + '.md'] })).not.toThrow();
    expect(() => validateSkillResources({ entry: 'SKILL.md' })).not.toThrow();
    expect(() => validateSkillResources({ entry: '../SKILL.md' })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: 'skills/guide/README.md' })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: 'a/'.repeat(33) + 'SKILL.md' })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: 'SKILL.md', resources: ['b'.repeat(241) + '.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/CON/SKILL.md' })).toThrow(/invalid skill entry/);
    const wideEntry = Array.from({ length: 12 }, () => '文'.repeat(77)).join('/') + '/SKILL.md';
    expect(wideEntry.length).toBeLessThanOrEqual(1024);
    expect(() => validateSkillResources({ entry: wideEntry })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: '文'.repeat(81) + '/SKILL.md' })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: 'SKILL.md', resources: [Array.from({ length: 12 }, () => '文'.repeat(77)).join('/') + '/notes.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'SKILL.md', resources: ['skills/NUL.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/guide/SKILL.md', resources: ['skills/guide/run.sh'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/guide/SKILL.md', resources: ['skills/guide/SKILL.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/guide/SKILL.md', resources: ['skills/guide/notes:1.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/a<b/SKILL.md' })).toThrow(/invalid skill entry/);
    expect(() => validateSkillResources({ entry: 'skills/guide/SKILL.md', resources: ['skills/a|b.md'] })).toThrow(/invalid skill resource/);
    expect(() => validateSkillResources({ entry: 'skills/a\tb/SKILL.md' })).toThrow(/invalid skill entry/);
  });

  it('accepts the shipped example skill companion', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../examples/plugins/skills/gonavi.plugin.json', import.meta.url), 'utf8')) as Manifest;
    const skill = manifest.contributes?.skills?.[0];
    expect(skill?.resources).toEqual(['skills/read-only-investigation/REFERENCE.md']);
    expect(() => validateSkillResources(skill ?? { entry: '' })).not.toThrow();
  });
});
