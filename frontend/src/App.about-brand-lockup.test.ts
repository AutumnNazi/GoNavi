import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
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

const readFirstPngPixelAlpha = (assetBase64: string): number => {
  const binary = globalThis.atob(assetBase64);
  const pngBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const idatChunks: Uint8Array[] = [];

  for (let offset = 8; offset + 12 <= pngBytes.length;) {
    const chunkLength = new DataView(
      pngBytes.buffer,
      pngBytes.byteOffset + offset,
      4,
    ).getUint32(0);
    const chunkType = String.fromCharCode(...pngBytes.slice(offset + 4, offset + 8));
    if (chunkType === 'IDAT') {
      idatChunks.push(pngBytes.slice(offset + 8, offset + 8 + chunkLength));
    }
    offset += chunkLength + 12;
  }

  const compressedLength = idatChunks.reduce((total, chunk) => total + chunk.length, 0);
  const compressedData = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of idatChunks) {
    compressedData.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }

  const scanlines = unzlibSync(compressedData);
  return scanlines[4] ?? -1;
};

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

  it('keeps a tile asset and a transparent about lockup for every selectable mascot', () => {
    const iconAssetPaths = brandIconsSource.match(/iconPath: '\/brand-icons\/\d{2}-.+\.webp'/g) || [];
    const aboutAssetPaths = brandIconsSource.match(/aboutPath: '\/brand-icons\/\d{2}-.+-about\.png'/g) || [];
    expect(iconAssetPaths).toHaveLength(10);
    expect(aboutAssetPaths).toHaveLength(10);

    for (const declaration of iconAssetPaths) {
      const assetPath = declaration.match(/'([^']+)'/)?.[1];
      expect(assetPath).toBeTruthy();
      expect(readFileSync(`${brandIconsDirectory}${assetPath?.replace('/brand-icons/', '')}`, 'base64')).not.toBe('');
    }

    for (const declaration of aboutAssetPaths) {
      const assetPath = declaration.match(/'([^']+)'/)?.[1];
      expect(assetPath).toBeTruthy();
      const assetBase64 = readFileSync(
        `${brandIconsDirectory}${assetPath?.replace('/brand-icons/', '')}`,
        'base64',
      );
      expect(assetBase64).not.toBe('');
      expect(globalThis.atob(assetBase64).charCodeAt(25)).toBe(6);
      expect(readFirstPngPixelAlpha(assetBase64)).toBe(0);
    }

    const webpFiles = readdirSync(brandIconsDirectory).filter((file) => file.endsWith('.webp'));
    expect(webpFiles).toHaveLength(10);
    const aboutPngFiles = readdirSync(brandIconsDirectory).filter((file) => file.endsWith('-about.png'));
    expect(aboutPngFiles).toHaveLength(10);
  });
});
