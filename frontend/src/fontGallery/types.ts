export const BaseURL = 'https://origin-download.syngnat.top:8443/gonavi/fonts/v1/';
export const AssetURLPrefix = '/__gonavi/font-gallery/assets/';

export interface FontAsset {
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: 'font/ttf' | 'font/otf' | 'font/collection' | 'font/woff2' | 'application/font-sfnt';
}
export interface FontLicense {
  id: string; name: string; url: string; notice: string; text: string; nonCommercial: boolean;
}
export interface FontEntry {
  id: string; version: string; kind: 'ui' | 'mono'; family: string;
  names: Record<string, string>; description: string; useCase: string;
  font: FontAsset; preview: FontAsset; attribution: string; sourceUrl: string;
  rightsStatus: 'approved'; license: FontLicense;
}
export interface FontCatalog { schemaVersion: 1; version: string; entries: FontEntry[] }
export interface FontInstalled { entry: FontEntry; family: string; url: string }
export interface FontPreviewed { entry: FontEntry; family: string; url: string }
export interface FontGalleryState {
  catalog: FontCatalog | null;
  installed: FontInstalled[];
  stale: boolean;
  warningCode?: string;
}
export interface FontProgress { requestId: string; downloaded: number; total: number; phase: string }
export interface FontGalleryAdapter {
  status(): Promise<FontGalleryState>;
  refresh(): Promise<FontGalleryState>;
  resolve(id: string, version: string): Promise<FontInstalled>;
  download(id: string, version: string, requestId: string, onProgress?: (progress: FontProgress) => void): Promise<FontInstalled>;
  preview(id: string, version: string, requestId: string, onProgress?: (progress: FontProgress) => void): Promise<FontPreviewed>;
  cancel(requestId: string): Promise<void>;
  remove(id: string, version: string): Promise<void>;
  dispose(): void;
}
export type FontGalleryErrorCode = 'invalid_catalog' | 'invalid_id' | 'unavailable' | 'download_failed'
  | 'integrity' | 'canceled' | 'storage_failed' | 'unsupported_environment' | 'preview_failed';
export class FontGalleryError extends Error {
  constructor(public readonly code: FontGalleryErrorCode) {
    super(code);
    this.name = 'FontGalleryError';
  }
}
export const FONT_GALLERY_CHANGED = 'gonavi:font-gallery-changed';
