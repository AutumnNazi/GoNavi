import { describe, expect, it } from 'vitest';
import { getPrimaryFontFamily, resolveFontSelection } from './fontFamilyDisplay';

describe('font selector display', () => {
  it.each([
    ['"JetBrainsMono Nerd Font Mono", ui-monospace, monospace', 'JetBrainsMono Nerd Font Mono'],
    ["'Font, With Comma', monospace", 'Font, With Comma'],
    ['SF Mono, Menlo, monospace', 'SF Mono'],
    ['"A\\"B", monospace', 'A"B'],
    ['', ''],
  ])('extracts the primary family from %s without exposing fallbacks', (value, expected) => {
    expect(getPrimaryFontFamily(value)).toBe(expected);
  });

  it('preserves an unmatched saved stack while fonts are loading or unavailable', () => {
    const value = '"Legacy Font", Menlo, monospace';
    expect(resolveFontSelection(value, [], 'monospace', 'Default')).toEqual({ value, label: 'Legacy Font' });
  });

  it('uses the option label after loading without rewriting the persisted stack', () => {
    const value = '"JetBrainsMono", monospace';
    expect(resolveFontSelection(value, [{ value, label: 'JetBrains Mono' }], 'monospace', 'Default'))
      .toEqual({ value, label: 'JetBrains Mono' });
  });

  it.each([null, undefined, '', '  ', 'monospace'])('uses a friendly default for %s', value => {
    expect(resolveFontSelection(value, [], 'monospace', 'Default')).toEqual({ value: 'monospace', label: 'Default' });
  });
});
