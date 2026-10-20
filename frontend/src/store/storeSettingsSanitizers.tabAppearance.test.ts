import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, PERSIST_VERSION } from './storeConstants';
import { sanitizeAppearance } from './storeSettingsSanitizers';
import type { AppearanceSettings } from './storeStateTypes';

const sanitize = (appearance: Partial<AppearanceSettings> | undefined) =>
  sanitizeAppearance(appearance, PERSIST_VERSION);

describe('sanitizeAppearance tab appearance fields', () => {
  it('ships the current behaviour as defaults', () => {
    expect(DEFAULT_APPEARANCE.tabAppearanceStyle).toBe('card');
    expect(DEFAULT_APPEARANCE.tabCloseButtonPosition).toBe('right');
  });

  it('falls back to the defaults when the whole appearance blob is missing', () => {
    expect(sanitize(undefined).tabAppearanceStyle).toBe('card');
    expect(sanitize(undefined).tabCloseButtonPosition).toBe('right');
  });

  it('falls back to the defaults when a legacy config lacks both fields', () => {
    const legacy = sanitize({ tabEnvironmentAccentThickness: 4 });
    expect(legacy.tabEnvironmentAccentThickness).toBe(4);
    expect(legacy.tabAppearanceStyle).toBe('card');
    expect(legacy.tabCloseButtonPosition).toBe('right');
  });

  it('keeps every legal persisted value', () => {
    expect(sanitize({ tabAppearanceStyle: 'underline' }).tabAppearanceStyle).toBe('underline');
    expect(sanitize({ tabAppearanceStyle: 'pill' }).tabAppearanceStyle).toBe('pill');
    expect(sanitize({ tabCloseButtonPosition: 'left' }).tabCloseButtonPosition).toBe('left');
    expect(sanitize({ tabCloseButtonPosition: 'right' }).tabCloseButtonPosition).toBe('right');
  });

  it('keeps a mixed legal combination intact', () => {
    const result = sanitize({ tabAppearanceStyle: 'pill', tabCloseButtonPosition: 'left' });
    expect(result.tabAppearanceStyle).toBe('pill');
    expect(result.tabCloseButtonPosition).toBe('left');
  });

  it('rejects dirty persisted values and undefined/null fields', () => {
    const dirty = [
      { tabAppearanceStyle: 'menu' as never, tabCloseButtonPosition: 'top' as never },
      { tabAppearanceStyle: null as never, tabCloseButtonPosition: null as never },
      { tabAppearanceStyle: '' as never, tabCloseButtonPosition: 0 as never },
      { tabAppearanceStyle: 'CARD' as never, tabCloseButtonPosition: 'LEFT' as never },
    ];
    dirty.forEach((appearance) => {
      const result = sanitize(appearance);
      expect(result.tabAppearanceStyle).toBe('card');
      expect(result.tabCloseButtonPosition).toBe('right');
    });
  });

  it('does not let the sibling field bleed across', () => {
    const result = sanitize({ tabAppearanceStyle: 'left' as never, tabCloseButtonPosition: 'card' as never });
    expect(result.tabAppearanceStyle).toBe('card');
    expect(result.tabCloseButtonPosition).toBe('right');
  });

  it('returns a complete appearance object for legacy partial configs', () => {
    const result = sanitize({ tabAppearanceStyle: 'underline' });
    expect(result).toMatchObject({
      enabled: DEFAULT_APPEARANCE.enabled,
      tabAppearanceStyle: 'underline',
      tabCloseButtonPosition: 'right',
    });
  });
});
