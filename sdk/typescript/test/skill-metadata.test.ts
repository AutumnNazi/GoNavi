import { describe, expect, it } from 'vitest';
import { validateSkillMetadata } from '../src/skillMetadata.js';
describe('skill metadata', () => {
  it('counts name and description in UTF-8 bytes', () => {
    expect(() => validateSkillMetadata({ name: '中'.repeat(85), description: '文'.repeat(682) })).not.toThrow();
    expect(() => validateSkillMetadata({ name: '中'.repeat(86), description: 'Notes' })).toThrow(/invalid skill name/);
    expect(() => validateSkillMetadata({ name: 'Guide', description: '文'.repeat(683) })).toThrow(/invalid skill description/);
  });
});
