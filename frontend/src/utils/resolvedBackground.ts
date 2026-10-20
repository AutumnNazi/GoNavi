import { sanitizeBackgroundImage } from './backgroundImage';
import type { GalleryEntry, GalleryInstalled } from '../backgroundGallery/types';
import { validateEntry } from '../backgroundGallery/validation';

export interface ResolvedBackground {
  dataUrl: string;
  name: string;
  nameKey?: string;
  fit: 'contain' | 'cover';
}
export function galleryEntryName(entry: GalleryEntry, language = 'en-US'): string {
  return entry.names[language] ?? entry.names[language.split('-')[0]] ?? entry.names['en-US'] ?? entry.names.en ?? Object.values(entry.names)[0];
}

// Only a verified local installation may resolve a gallery ID. This function never fetches.
export function resolvedBackground(selection: {
  builtinId?: unknown; builtinVersion?: string; image: unknown; gallery?: GalleryInstalled | null;
}, language?: string): ResolvedBackground | null {
  if (selection.builtinId) {
    const gallery = selection.gallery;
    if (!gallery || gallery.entry.id !== selection.builtinId
        || (selection.builtinVersion && gallery.entry.version !== selection.builtinVersion)) return null;
    try { validateEntry(gallery.entry); } catch { return null; }
    const localPath = '/__gonavi/background-gallery/' + gallery.entry.image.path;
    if (gallery.url !== localPath && !/^blob:[a-zA-Z0-9:/._%-]+$/.test(gallery.url)) return null;
    return { dataUrl: gallery.url, name: galleryEntryName(gallery.entry, language), fit: gallery.entry.fit };
  }
  const image = sanitizeBackgroundImage(selection.image);
  return image ? { ...image, fit: 'cover' } : null;
}
