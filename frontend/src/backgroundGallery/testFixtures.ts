import type { GalleryEntry, GalleryInstalled } from './types';
export function galleryEntry(id = 'whale-maid-a'): GalleryEntry {
  const hash = (id === 'whale-maid-b' ? 'b' : 'a').repeat(64);
  const asset = { path: 'assets/' + hash + '.png', sha256: hash, sizeBytes: 60, width: 1, height: 1, mimeType: 'image/png' as const };
  return { id, version: '1', names: { 'en-US': id, 'zh-CN': id }, fit: 'contain', image: { ...asset }, thumbnail: { ...asset },
    attribution: 'Synthetic fixture author', sourceUrl: 'https://example.org/source', rightsStatus: 'approved',
    license: { id: 'test', name: 'Test license', url: 'https://example.org/license', notice: 'Synthetic fixture notice', text: 'Synthetic fixture license text', nonCommercial: true } };
}
export function galleryInstalled(id = 'whale-maid-a'): GalleryInstalled {
  const entry = galleryEntry(id);
  return { entry, url: '/__gonavi/background-gallery/' + entry.image.path };
}
