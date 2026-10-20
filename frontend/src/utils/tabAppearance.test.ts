import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAB_APPEARANCE_STYLE,
  DEFAULT_TAB_CLOSE_BUTTON_POSITION,
  TAB_APPEARANCE_STYLE_LABEL_KEYS,
  TAB_APPEARANCE_STYLES,
  TAB_CLOSE_BUTTON_POSITION_LABEL_KEYS,
  TAB_CLOSE_BUTTON_POSITIONS,
  sanitizeTabAppearanceStyle,
  sanitizeTabCloseButtonPosition,
  type TabAppearanceStyle,
  type TabCloseButtonPosition,
} from './tabAppearance';

describe('tabAppearance', () => {
  it('exposes the frozen option lists and current-behaviour defaults', () => {
    expect([...TAB_APPEARANCE_STYLES]).toEqual(['card', 'underline', 'pill']);
    expect([...TAB_CLOSE_BUTTON_POSITIONS]).toEqual(['left', 'right']);
    expect(DEFAULT_TAB_APPEARANCE_STYLE).toBe('card');
    expect(DEFAULT_TAB_CLOSE_BUTTON_POSITION).toBe('right');
  });

  it('passes every known value through unchanged', () => {
    TAB_APPEARANCE_STYLES.forEach((style) => {
      expect(sanitizeTabAppearanceStyle(style)).toBe(style);
    });
    TAB_CLOSE_BUTTON_POSITIONS.forEach((position) => {
      expect(sanitizeTabCloseButtonPosition(position)).toBe(position);
    });
  });

  it('falls back to the default for undefined, null and unknown values', () => {
    const dirtyValues: unknown[] = [
      undefined,
      null,
      '',
      'Menu',
      'CARD',
      'underline ',
      0,
      1,
      true,
      false,
      {},
      [],
      ['card'],
      { style: 'card' },
      Symbol('card'),
    ];
    dirtyValues.forEach((value) => {
      expect(sanitizeTabAppearanceStyle(value)).toBe(DEFAULT_TAB_APPEARANCE_STYLE);
    });
    dirtyValues.forEach((value) => {
      expect(sanitizeTabCloseButtonPosition(value)).toBe(DEFAULT_TAB_CLOSE_BUTTON_POSITION);
    });
  });

  it('treats the other option list values as unknown for the sibling field', () => {
    expect(sanitizeTabAppearanceStyle('left')).toBe(DEFAULT_TAB_APPEARANCE_STYLE);
    expect(sanitizeTabAppearanceStyle('right')).toBe(DEFAULT_TAB_APPEARANCE_STYLE);
    expect(sanitizeTabCloseButtonPosition('card')).toBe(DEFAULT_TAB_CLOSE_BUTTON_POSITION);
  });

  it('maps every option to its settings-panel catalog key', () => {
    expect(TAB_APPEARANCE_STYLE_LABEL_KEYS).toEqual({
      card: 'app.theme.tab_appearance.style.card',
      underline: 'app.theme.tab_appearance.style.underline',
      pill: 'app.theme.tab_appearance.style.pill',
    });
    expect(TAB_CLOSE_BUTTON_POSITION_LABEL_KEYS).toEqual({
      left: 'app.theme.tab_appearance.close_position.left',
      right: 'app.theme.tab_appearance.close_position.right',
    });
    TAB_APPEARANCE_STYLES.forEach((style: TabAppearanceStyle) => {
      expect(TAB_APPEARANCE_STYLE_LABEL_KEYS[style]).toMatch(/^app\.theme\.tab_appearance\.style\./);
    });
    TAB_CLOSE_BUTTON_POSITIONS.forEach((position: TabCloseButtonPosition) => {
      expect(TAB_CLOSE_BUTTON_POSITION_LABEL_KEYS[position])
        .toMatch(/^app\.theme\.tab_appearance\.close_position\./);
    });
  });
});
