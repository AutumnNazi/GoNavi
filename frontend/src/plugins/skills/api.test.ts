import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginSkills: vi.fn(), PluginSkillRead: vi.fn(), PluginSkillResourceRead: vi.fn(), AIGetSkills: vi.fn(), AISaveSkill: vi.fn(), PluginSetEnabled: vi.fn() }));
vi.mock('../../../wailsjs/go/app/App', () => host);
import { packagedSkillAPI } from './api';
const skill = { pluginId: 'example.docs', id: 'guide', name: 'Guide', description: 'Read-only guidance', entry: 'SKILL.md',
  version: '1.0.0', digest: 'a'.repeat(64), generation: 2, available: true };
const body = { pluginId: skill.pluginId, skillId: skill.id, name: skill.name, description: skill.description,
  version: skill.version, digest: skill.digest, generation: skill.generation, content: 'Never automatically injected.' };
beforeEach(() => { vi.resetAllMocks(); host.PluginSkills.mockResolvedValue({ success: true, data: { items: [skill] } }); host.PluginSkillRead.mockResolvedValue({ success: true, data: body }); });
describe('explicit packaged skill adapter', () => {
  it('lists metadata without loading content, enabling plugins, or touching legacy user skills', async () => {
    expect(await packagedSkillAPI.list()).toHaveLength(1);
    expect(host.PluginSkillRead).not.toHaveBeenCalled(); expect(host.PluginSetEnabled).not.toHaveBeenCalled();
    expect(host.AIGetSkills).not.toHaveBeenCalled(); expect(host.AISaveSkill).not.toHaveBeenCalled();
  });
  it('reads only the explicit identity/digest/generation and pins a copy before awaiting', async () => {
    const mutable = { ...skill }; const pending = packagedSkillAPI.read(mutable); mutable.digest = 'b'.repeat(64);
    expect((await pending).content).toBe(body.content);
    expect(host.PluginSkillRead).toHaveBeenCalledWith(skill.pluginId, skill.id, skill.digest, skill.generation);
    expect(host.AISaveSkill).not.toHaveBeenCalled();
  });
  it('blocks unavailable or malformed requests before dispatch', async () => {
    await expect(packagedSkillAPI.read({ ...skill, available: false })).rejects.toThrow();
    await expect(packagedSkillAPI.read({ ...skill, digest: 'bad' })).rejects.toThrow();
    expect(host.PluginSkillRead).not.toHaveBeenCalled();
  });
  it('reads one declared companion without loading the entry document', async () => {
    const declared = { ...skill, resources: ['skills/guide/REFERENCE.md'] };
    host.PluginSkillResourceRead.mockResolvedValue({ success: true, data: { ...body, resource: 'skills/guide/REFERENCE.md', content: 'notes' } });
    expect((await packagedSkillAPI.readResource(declared, 'skills/guide/REFERENCE.md')).content).toBe('notes');
    expect(host.PluginSkillResourceRead).toHaveBeenCalledWith(skill.pluginId, skill.id, skill.digest, 'skills/guide/REFERENCE.md', skill.generation);
    expect(host.PluginSkillRead).not.toHaveBeenCalled();
    await expect(packagedSkillAPI.readResource(declared, '../SECRET.md')).rejects.toThrow();
    const longResource = 'a'.repeat(200) + '/' + 'b'.repeat(200) + '/notes.md';
    const longSkill = { ...skill, resources: [longResource] };
    host.PluginSkillResourceRead.mockResolvedValue({ success: true, data: { ...body, resource: longResource, content: 'notes' } });
    expect((await packagedSkillAPI.readResource(longSkill, longResource)).content).toBe('notes');
    expect(host.PluginSkillResourceRead).toHaveBeenCalledWith(skill.pluginId, skill.id, skill.digest, longResource, skill.generation);
    await expect(packagedSkillAPI.readResource({ ...skill, resources: ['c'.repeat(241) + '.md'] }, 'c'.repeat(241) + '.md')).rejects.toThrow();
  });
  it('rejects a stale body response', async () => {
    host.PluginSkillRead.mockResolvedValue({ success: true, data: { ...body, generation: 3 } });
    await expect(packagedSkillAPI.read(skill)).rejects.toThrow();
  });
});
