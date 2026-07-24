import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);
const brandIconsSource = readFileSync(
  fileURLToPath(new globalThis.URL('./brand/brandIcons.ts', import.meta.url)),
  'utf8',
);
const brandIconsDirectory = fileURLToPath(
  new globalThis.URL('../public/brand-icons/', import.meta.url),
);
const defaultTitlebarMark = fileURLToPath(
  new globalThis.URL('../public/brand-marks/02-database-search-transparent.png', import.meta.url),
);

describe('about brand lockup', () => {
  it('uses a transparent lockup without a tile background on the about page', () => {
    expect(appSource).toContain('resolveBrandAboutSrc');
    expect(appSource).toContain('src={resolveBrandAboutSrc(brandIconId)}');

    const aboutLogoStart = appSource.indexOf('src={resolveBrandAboutSrc(brandIconId)}');
    const aboutLogoSnippet = appSource.slice(aboutLogoStart, aboutLogoStart + 640);
    expect(aboutLogoSnippet).toContain("background: 'transparent'");
    expect(aboutLogoSnippet).toContain("boxShadow: 'none'");
  });

  it('uses the transparent compact mark without a forced titlebar tile', () => {
    expect(appSource).toContain('src={resolveBrandTitlebarSrc(brandIconId)}');

    const titlebarLogoStart = appSource.indexOf('src={resolveBrandTitlebarSrc(brandIconId)}');
    const titlebarLogoSnippet = appSource.slice(titlebarLogoStart, titlebarLogoStart + 640);
    expect(titlebarLogoSnippet).toContain("background: 'transparent'");
    expect(readFileSync(defaultTitlebarMark, 'base64')).not.toHaveLength(0);
  });

  it('keeps one shared lossless WebP asset for every selectable mascot', () => {
    const iconAssetPaths = brandIconsSource.match(/iconPath: '\/brand-icons\/\d{2}-.+\.webp'/g) || [];
    expect(iconAssetPaths).toHaveLength(10);
    for (const declaration of iconAssetPaths) {
      const assetPath = declaration.match(/'([^']+)'/)?.[1];
      expect(assetPath).toBeTruthy();
      expect(readFileSync(`${brandIconsDirectory}${assetPath?.replace('/brand-icons/', '')}`, 'utf8')).not.toBe('');
    }

    const webpFiles = readdirSync(brandIconsDirectory).filter((file) => file.endsWith('.webp'));
    expect(webpFiles).toHaveLength(10);
    const legacyPngFiles = readdirSync(brandIconsDirectory).filter((file) => file.endsWith('.png'));
    expect(legacyPngFiles).toEqual([]);
  });
});
