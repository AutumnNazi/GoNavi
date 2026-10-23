import { describe, expect, it } from 'vitest';
import { decodeInspection } from './decode';
const inspection = (entry = 'skills/guide/SKILL.md', resources: string[] = ['skills/guide/REFERENCE.md']) => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'example.skills', name: 'Skills', version: '1.0.0', permissions: ['ai.skills'],
    contributes: { skills: [{ id: 'guide', name: 'Guide', description: 'Notes', entry, resources }] } },
  digest: 'a'.repeat(64), sourcePath: 'fixture', sizeBytes: 10,
});
describe('skill manifest decoding', () => {
  it('keeps a declared markdown companion and rejects scripts or parent paths', () => {
    expect(decodeInspection(inspection()).manifest.contributes?.skills?.[0].resources).toEqual(['skills/guide/REFERENCE.md']);
    expect(() => decodeInspection(inspection('../SKILL.md'))).toThrow();
    expect(() => decodeInspection(inspection('skills/guide/SKILL.md', ['skills/guide/run.sh']))).toThrow();
    expect(() => decodeInspection(inspection('a/'.repeat(33) + 'SKILL.md'))).toThrow();
    expect(() => decodeInspection(inspection('SKILL.md', ['b'.repeat(241) + '.md']))).toThrow();
    expect(() => decodeInspection(inspection('skills/CON/SKILL.md'))).toThrow();
    expect(() => decodeInspection(inspection('skills/a<b/SKILL.md'))).toThrow();
    expect(() => decodeInspection(inspection('skills/guide/SKILL.md', ['skills/a|b.md']))).toThrow();
    expect(() => decodeInspection(inspection('skills/a\tb/SKILL.md'))).toThrow();
    const wideEntry = Array.from({ length: 12 }, () => '文'.repeat(77)).join('/') + '/SKILL.md';
    expect(wideEntry.length).toBeLessThanOrEqual(1024);
    expect(() => decodeInspection(inspection(wideEntry))).toThrow();
    expect(() => decodeInspection(inspection('文'.repeat(81) + '/SKILL.md'))).toThrow();
    expect(() => decodeInspection(inspection('SKILL.md', ['skills/NUL.md']))).toThrow();
    expect(() => decodeInspection(inspection('skills/guide/SKILL.md', ['skills/guide/SKILL.md']))).toThrow();
    expect(decodeInspection(inspection('SKILL.md', ['a'.repeat(237) + '.md'])).manifest.contributes?.skills?.[0].resources?.[0]).toHaveLength(240);
  });
  it('counts skill name and description in UTF-8 bytes', () => {
    const withText = (name: string, description: string) => decodeInspection({
      ...inspection(),
      manifest: { ...inspection().manifest, contributes: { skills: [{ id: 'guide', name, description, entry: 'SKILL.md' }] } },
    });
    expect(withText('中'.repeat(85), '文'.repeat(682)).manifest.contributes?.skills?.[0].name).toHaveLength(85);
    expect(() => withText('中'.repeat(86), 'Notes')).toThrow();
    expect(() => withText('Guide', '文'.repeat(683))).toThrow();
  });
});
