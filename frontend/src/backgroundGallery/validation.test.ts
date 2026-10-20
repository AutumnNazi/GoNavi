import { describe, expect, it } from 'vitest';
import { assetURL, MAX_CATALOG_BYTES, parseCatalog, rasterDimensions, validateCatalog, validateImage } from './validation';
import { webcrypto } from 'node:crypto';
import type { GalleryCatalog, GalleryEntry } from './types';

export function entry(): GalleryEntry {
  const asset = { path: 'assets/' + 'a'.repeat(64) + '.png', sha256: 'a'.repeat(64), sizeBytes: 60, width: 1, height: 1, mimeType: 'image/png' as const };
  return { id: 'test-pattern', version: '1', names: { en: 'Synthetic test' }, fit: 'contain',
    image: { ...asset }, thumbnail: { ...asset }, attribution: 'Test author', sourceUrl: 'https://example.org/source',
    rightsStatus: 'approved', license: { id: 'test', name: 'Test license', url: 'https://example.org/license',
      notice: 'Synthetic fixture only', text: 'Test license text', nonCommercial: true } };
}
export function catalog(): GalleryCatalog { return { schemaVersion: 1, version: '1', entries: [entry()] }; }

// Synthetic container structure, never artwork. Pixel decoding is an injected browser boundary.
export function pngBytes(width = 1, height = 1, animated = false) {
  const chunk = (name: string, payload: number[]) => {
    const result = new Uint8Array(12 + payload.length);
    new DataView(result.buffer).setUint32(0, payload.length);
    result.set(new TextEncoder().encode(name), 4); result.set(payload, 8);
    return Array.from(result);
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 6;
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', Array.from(header)), ...(animated ? chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]) : []),
    ...chunk('IDAT', [1]), ...chunk('IEND', [])]);
}
export async function imageFixture() {
  const bytes = pngBytes();
  const hash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
  const value = entry();
  value.image = { ...value.image, path: 'assets/' + hash + '.png', sha256: hash, sizeBytes: bytes.length };
  value.thumbnail = { ...value.image };
  return { bytes, entry: value, catalog: { schemaVersion: 1 as const, version: '1', entries: [value] } };
}

function webpBytes(chunks: Array<[string, number[]]>) {
  const payload: number[] = [];
  for (const [name, values] of chunks) {
    const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, values.length, true);
    payload.push(...new TextEncoder().encode(name), ...size, ...values, ...(values.length % 2 ? [0] : []));
  }
  const result = new Uint8Array(12 + payload.length);
  result.set(new TextEncoder().encode('RIFF')); new DataView(result.buffer).setUint32(4, result.length - 8, true);
  result.set(new TextEncoder().encode('WEBP'), 8); result.set(payload, 12); return result;
}

describe('image integrity before browser use', () => {
  it('accepts static JPEG and WebP headers while rejecting animated or dimension-conflicting containers', () => {
    const jpeg = new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
    expect(rasterDimensions(jpeg, 'image/jpeg')).toEqual({ width: 1, height: 1 });
    const duplicateFrame = new Uint8Array([...jpeg.slice(0, 15), ...jpeg.slice(2)]);
    expect(() => rasterDimensions(duplicateFrame, 'image/jpeg')).toThrow('integrity');
    const frame: [string, number[]] = ['VP8L', [47, 0, 0, 0, 0]];
    expect(rasterDimensions(webpBytes([frame]), 'image/webp')).toEqual({ width: 1, height: 1 });
    expect(() => rasterDimensions(webpBytes([['VP8X', [2,0,0,0,0,0,0,0,0,0]], frame]), 'image/webp')).toThrow('integrity');
    expect(() => rasterDimensions(webpBytes([frame, ['VP8X', [0,0,0,0,0,0,0,0,0,0]]]), 'image/webp')).toThrow('integrity');
    expect(() => rasterDimensions(webpBytes([frame, frame]), 'image/webp')).toThrow('integrity');
    expect(() => rasterDimensions(pngBytes(24_000_001, 1), 'image/png')).toThrow('integrity');
    expect(() => rasterDimensions(new TextEncoder().encode('<svg/>'), 'image/png')).toThrow('integrity');
  });
  it('rejects image header and browser-decoder dimension disagreement', async () => {
    const f = await imageFixture(); const blob = new Blob([f.bytes], { type: 'image/png' });
    await expect(validateImage(blob, f.entry.image, webcrypto.subtle as SubtleCrypto, async () => ({ width: 2, height: 1 }))).rejects.toThrow('integrity');
    await expect(validateImage(blob, f.entry.image, webcrypto.subtle as SubtleCrypto, async () => { throw new Error('decoder rejected malformed pixels'); })).rejects.toThrow('integrity');
  });
  it('checks hash and dimensions and rejects animation before decoding', async () => {
    const fixture = await imageFixture();
    const decode = async () => ({ width: 1, height: 1 });
    await expect(validateImage(new Blob([fixture.bytes], { type: 'image/png' }), fixture.entry.image, webcrypto.subtle as SubtleCrypto, decode)).resolves.toBeUndefined();
    await expect(validateImage(new Blob([fixture.bytes], { type: 'image/png' }), { ...fixture.entry.image, sha256: 'b'.repeat(64) }, webcrypto.subtle as SubtleCrypto, decode)).rejects.toThrow();
    const animated = pngBytes(1, 1, true);
    await expect(validateImage(new Blob([animated], { type: 'image/png' }), { ...fixture.entry.image, sizeBytes: animated.length }, webcrypto.subtle as SubtleCrypto, decode)).rejects.toThrow('integrity');
  });
});

describe('approved bounded gallery catalog', () => {
  it.each([
    (c: GalleryCatalog) => c.entries.push(c.entries[0]),
    (c: GalleryCatalog) => { c.entries[0].image.path = 'https://evil.example/image.png'; },
    (c: GalleryCatalog) => { c.entries[0].thumbnail.sizeBytes = 256 * 1024 + 1; },
    (c: GalleryCatalog) => { c.entries[0].image.width = 24_000_001; },
    (c: GalleryCatalog) => { c.entries[0].image.sha256 = 'A'.repeat(64); },
    (c: GalleryCatalog) => { c.entries[0].sourceUrl = 'javascript:alert(1)'; },
    (c: GalleryCatalog) => { c.entries[0].license.text = ''; },
    (c: GalleryCatalog) => { c.entries[0].version = '../1'; },
    (c: GalleryCatalog) => { c.entries[0].id = '../test'; },
    (c: GalleryCatalog) => { Object.assign(c.entries[0], { extra: 'not allowed' }); },
    (c: GalleryCatalog) => { c.entries = Array.from({ length: 65 }, (_, i) => ({ ...entry(), id: 'test-' + i })); },
  ])('rejects malformed catalogues atomically', (mutate) => {
    const value = catalog(); mutate(value);
    expect(() => validateCatalog(value)).toThrow('invalid_catalog');
  });
  it('bounds raw JSON bytes and forbids path tricks before constructing asset URLs', () => {
    expect(() => parseCatalog(new Uint8Array(MAX_CATALOG_BYTES + 1))).toThrow('invalid_catalog');
    for (const path of ['../image.png', 'assets/%2e%2e/image.png', '//evil.example/x', entry().image.path + '?q=1']) {
      expect(() => assetURL({ ...entry().image, path })).toThrow('invalid_catalog');
    }
  });
  it('accepts the shared contract and rejects an unapproved entry instead of partially accepting it', () => {
    expect(validateCatalog(catalog())).toEqual(catalog());
    const invalid = catalog();
    Object.assign(invalid.entries[0], { rightsStatus: 'pending' });
    expect(() => validateCatalog(invalid)).toThrow('invalid_catalog');
  });
});
