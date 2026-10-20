import { describe, expect, it } from 'vitest';
import { galleryEntry } from './testFixtures';
import { validateCatalog } from './validation';

describe('original artwork byte budget', () => {
  it.each([11_254_649, 16 * 1024 * 1024])('accepts %i-byte original without reducing resolution', (sizeBytes) => {
    const entry = galleryEntry();
    entry.image = { ...entry.image, path: 'assets/' + entry.image.sha256 + '.jpg', mimeType: 'image/jpeg', width: 3072, height: 5504, sizeBytes };
    expect(() => validateCatalog({ schemaVersion: 1, version: 'test', entries: [entry] })).not.toThrow();
  });
  it('still rejects over-budget originals and oversized thumbnails', () => {
    const entry = galleryEntry();
    entry.image.sizeBytes = 16 * 1024 * 1024 + 1;
    expect(() => validateCatalog({ schemaVersion: 1, version: 'test', entries: [entry] })).toThrow();
    entry.image.sizeBytes = 60;
    entry.thumbnail.sizeBytes = 256 * 1024 + 1;
    expect(() => validateCatalog({ schemaVersion: 1, version: 'test', entries: [entry] })).toThrow();
  });
});
