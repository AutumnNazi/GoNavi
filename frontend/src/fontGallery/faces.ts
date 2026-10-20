import { FONT_GALLERY_CHANGED, FontGalleryError, type FontInstalled } from './types';

const loadedFaces = new Map<string, { url: string; face: FontFace }>();

// 仅在真实文件解码成功后允许切换到下载字体。
export async function loadDownloadedFont(item: FontInstalled): Promise<void> {
  if (loadedFaces.get(item.family)?.url === item.url) return;
  try {
    const face = new FontFace(item.family, 'url("' + item.url + '")');
    await face.load();
    if (face.status !== 'loaded') throw new FontGalleryError('integrity');
    const previous = loadedFaces.get(item.family);
    if (previous) document.fonts.delete(previous.face);
    document.fonts.add(face);
    loadedFaces.set(item.family, { url: item.url, face });
  } catch {
    throw new FontGalleryError('integrity');
  }
}

function format(mimeType: string): string {
  if (mimeType.includes('woff2')) return 'woff2';
  if (mimeType.includes('otf')) return 'opentype';
  if (mimeType.includes('collection')) return 'collection';
  return 'truetype';
}

export function injectDownloadedFontFaces(installed: FontInstalled[]): void {
  for (const [family, cached] of loadedFaces) {
    if (!installed.some(item => item.family === family && item.url === cached.url)) {
      document.fonts.delete(cached.face);
      loadedFaces.delete(family);
    }
  }
  let style = document.getElementById('gonavi-font-gallery-faces');
  if (!style) {
    style = document.createElement('style');
    style.id = 'gonavi-font-gallery-faces';
    document.head.appendChild(style);
  }
  style.textContent = installed.map(item => (
    '@font-face{font-family:"' + item.family + '";src:url("' + item.url + '") format("' + format(item.entry.font.mimeType) + '");font-display:block;}'
  )).join('\n');
}

export function notifyFontGalleryChanged(): void {
  window.dispatchEvent(new Event(FONT_GALLERY_CHANGED));
}
