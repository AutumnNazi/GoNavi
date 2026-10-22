import { describe, expect, it } from 'vitest';
import { validateSkillDocument } from '../src/skillDocument.js';
describe('skill document bytes', () => {
  it('accepts 65535 bytes and rejects 65538 bytes without echoing the text', () => {
    expect(() => validateSkillDocument('文'.repeat(21845))).not.toThrow();
    expect(() => validateSkillDocument(' \n\t')).not.toThrow();
    expect(() => validateSkillDocument('文'.repeat(21846))).toThrow(/^skill document is empty or exceeds size limit$/);
    expect(() => validateSkillDocument('')).toThrow(/empty or exceeds/);
    expect(() => validateSkillDocument('a\0b')).toThrow(/empty or exceeds/);
  });
});
