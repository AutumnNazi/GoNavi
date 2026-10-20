import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvedBackground } from './resolvedBackground';
import { BUILTIN_BACKGROUNDS } from './builtinBackgrounds';
import { galleryInstalled } from '../backgroundGallery/testFixtures';
const image = { name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };

describe('trusted background resolution', () => {
  it.each(BUILTIN_BACKGROUNDS)('keeps uncached legacy $id unresolved instead of loading bundled or remote bytes', builtin => {
    expect(resolvedBackground({ builtinId: builtin.id, image })).toBeNull();
    expect(builtin).not.toHaveProperty('url');
  });
  it('uses only a matching locally resolved installation and its fit', () => {
    const gallery = galleryInstalled();
    expect(resolvedBackground({ builtinId: gallery.entry.id, image: null, gallery })).toEqual({ dataUrl: gallery.url, name: gallery.entry.id, fit: 'contain' });
    expect(resolvedBackground({ builtinId: 'whale-maid-b', image: null, gallery })).toBeNull();
    expect(resolvedBackground({ builtinId: gallery.entry.id, builtinVersion: '2', image: null, gallery })).toBeNull();
    expect(resolvedBackground({ builtinId: gallery.entry.id, image: null, gallery: { ...gallery, url: 'https://evil.example/a.png' } })).toBeNull();
  });
  it('keeps uploaded JPEG validation and cover sizing', () => {
    expect(resolvedBackground({ image })).toEqual({ ...image, fit: 'cover' });
    expect(resolvedBackground({ image: null })).toBeNull();
  });
  it.each(['https://evil.example/a.webp', 'data:image/svg+xml,<svg/>', 'blob:local', '__proto__'])('cannot inject URL %s', url => {
    expect(resolvedBackground({ builtinId: url, image: null })).toBeNull();
    expect(resolvedBackground({ image: { ...image, dataUrl: url } })).toBeNull();
  });
  it('contains no static image imports or inline artwork in the legacy catalog', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/utils/builtinBackgrounds.ts'), 'utf8');
    expect(source).not.toMatch(/import .*\.(webp|png|jpe?g)|data:image/);
  });
});
