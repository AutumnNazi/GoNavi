import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateSkillMetadata } from '../src/skillMetadata.js';
import { validateSkillResources } from '../src/skillResources.js';
describe('shipped skill example', () => {
  it('accepts the declared companion and rejects a script', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../examples/plugins/skills/gonavi.plugin.json', import.meta.url), 'utf8')) as {
      contributes?: { skills?: { name: string; description: string; entry: string; resources?: string[] }[] };
    };
    const skill = manifest.contributes?.skills?.[0];
    expect(skill?.resources).toEqual(['skills/read-only-investigation/REFERENCE.md']);
    expect(() => validateSkillMetadata(skill ?? { name: '', description: '' })).not.toThrow();
    expect(() => validateSkillResources(skill ?? { entry: '' })).not.toThrow();
    expect(() => validateSkillResources({ entry: skill?.entry ?? '', resources: ['skills/read-only-investigation/run.sh'] })).toThrow(/invalid skill resource/);
  });
});
