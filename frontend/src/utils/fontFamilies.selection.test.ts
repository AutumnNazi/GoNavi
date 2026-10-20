import { describe, expect, it } from 'vitest';
import { buildFontFamilyOptions, DEFAULT_MONO_FONT_FAMILY } from './fontFamilies';

describe('system font selection', () => {
  it('keeps installed fonts without programming keywords available in the code selector', () => {
    const options = buildFontFamilyOptions('linux', 'mono', ['Victor', 'Maple', 'Zed Mono']);
    expect(options.some(option => option.label === 'Victor')).toBe(true);
    expect(options.some(option => option.label === 'Maple')).toBe(true);
  });

  it('orders defaults and installed fonts without mixing in unavailable presets', () => {
    const options = buildFontFamilyOptions('linux', 'mono', ['Alpha', 'Zulu Mono']);
    expect(options[0].value).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(options[1].label).toBe('Zulu Mono');
    expect(options[2].label).toBe('Alpha');
    expect(options).toHaveLength(3);
  });

  it('keeps only installed UI fonts and a localized default', () => {
    const options = buildFontFamilyOptions('linux', 'ui', ['Zulu Sans'], key => key);
    expect(options[0].label).toBe('app.theme.font_family.default_ui_option');
    expect(options[1].label).toBe('Zulu Sans');
    expect(options).toHaveLength(2);
  });
});
