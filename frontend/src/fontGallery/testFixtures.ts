import type { FontEntry, FontInstalled } from './types';
export function fontEntry(id = 'fixture-mono', version = '1'): FontEntry {
  const asset = { path: 'assets/' + 'a'.repeat(64) + '.ttf', sha256: 'a'.repeat(64), sizeBytes: 12, mimeType: 'font/ttf' as const };
  return { id, version, kind: 'mono', family: id, names: { 'en-US': id }, description: 'Synthetic fixture', useCase: 'Test only',
    font: asset, preview: asset, attribution: 'Synthetic fixture', sourceUrl: 'https://example.com/source', rightsStatus: 'approved',
    license: { id: 'test', name: 'Synthetic test', url: 'https://example.com/license', notice: 'Test only', text: 'Test only', nonCommercial: false } };
}
export function fontInstalled(entry = fontEntry()): FontInstalled {
  return { entry, family: 'GoNaviFont-' + entry.id, url: '/__gonavi/font-gallery/' + entry.font.path };
}
