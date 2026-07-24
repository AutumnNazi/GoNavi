import { describe, expect, it } from 'vitest';
import {
  BRAND_ICONS,
  resolveBrandAboutSrc,
  resolveBrandDockSrc,
  resolveBrandFullSrc,
  resolveBrandIconSrc,
  resolveBrandTitlebarSrc,
} from './brandIcons';

describe('brand icon asset resolution', () => {
  it('keeps tile assets for app surfaces and uses a transparent lockup on the about page', () => {
    for (const icon of BRAND_ICONS) {
      const selectedAsset = resolveBrandIconSrc(icon.id);
      expect(selectedAsset).toMatch(/^\/brand-icons\/\d{2}-.+\.webp$/);
      expect(resolveBrandFullSrc(icon.id)).toBe(selectedAsset);
      expect(resolveBrandDockSrc(icon.id)).toBe(selectedAsset);

      const aboutAsset = resolveBrandAboutSrc(icon.id);
      expect(aboutAsset).toMatch(/^\/brand-icons\/\d{2}-.+-about\.png$/);
      expect(aboutAsset).not.toBe(selectedAsset);
    }
  });

  it('uses the transparent compact mark for the default titlebar icon', () => {
    const defaultTitlebarAsset = '/brand-marks/02-database-search-transparent.png';
    expect(resolveBrandTitlebarSrc('02')).toBe(defaultTitlebarAsset);
    expect(resolveBrandTitlebarSrc()).toBe(defaultTitlebarAsset);
    expect(resolveBrandTitlebarSrc('unknown')).toBe(defaultTitlebarAsset);
    expect(resolveBrandTitlebarSrc('01')).toBe(resolveBrandIconSrc('01'));
  });

  it('falls back to the default transparent about lockup for invalid selections', () => {
    const defaultAboutAsset = resolveBrandAboutSrc('02');
    expect(resolveBrandAboutSrc()).toBe(defaultAboutAsset);
    expect(resolveBrandAboutSrc('unknown')).toBe(defaultAboutAsset);
  });
});
