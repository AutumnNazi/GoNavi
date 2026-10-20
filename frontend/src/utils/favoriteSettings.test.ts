import { describe, expect, it } from 'vitest';
import { DEFAULT_FAVORITE_SETTINGS, moveFavoriteSetting, sanitizeFavoriteSettings, toggleFavoriteSetting } from './favoriteSettings';

describe('favorite settings selection', () => {
  it('uses defaults for old profiles, while preserving an intentionally empty list', () => {
    expect(sanitizeFavoriteSettings(undefined)).toEqual(DEFAULT_FAVORITE_SETTINGS);
    expect(sanitizeFavoriteSettings([])).toEqual([]);
    expect(sanitizeFavoriteSettings(['density', 'density', null, 'bad'])).toEqual(['density']);
  });
  it('allows catalog settings and preserves user order', () => {
    const id = 'entry:fonts-settings/fonts-settings/app.theme.font_family.ui_title';
    expect(sanitizeFavoriteSettings([id, 'layout'])).toEqual([id, 'layout']);
    expect(moveFavoriteSetting([id, 'layout'], 'layout', -1)).toEqual(['layout', id]);
    expect(toggleFavoriteSetting([id, 'layout'], 'layout')).toEqual([id]);
    expect(toggleFavoriteSetting([], 'rows')).toEqual(['rows']);
  });
});
