export const BaseURL = 'https://origin-download.syngnat.top:8443/gonavi/backgrounds/v1/';

export interface GalleryAsset {
  path: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg';
}

export interface GalleryLicense {
  id: string;
  name: string;
  url: string;
  notice: string;
  text: string;
  nonCommercial: boolean;
}

export interface GalleryEntry {
  id: string;
  version: string;
  names: Record<string, string>;
  fit: 'contain' | 'cover';
  image: GalleryAsset;
  thumbnail: GalleryAsset;
  attribution: string;
  sourceUrl: string;
  rightsStatus: 'approved';
  license: GalleryLicense;
}

export interface GalleryCatalog {
  schemaVersion: 1;
  version: string;
  entries: GalleryEntry[];
}

export interface GalleryInstalled { entry: GalleryEntry; url: string }
export interface GalleryState {
  catalog: GalleryCatalog | null;
  installed: GalleryInstalled[];
  stale: boolean;
  warningCode?: string;
}
export interface GalleryProgress {
  requestId: string;
  downloaded: number;
  total: number;
  phase: string;
}
export interface GalleryAdapter {
  status(): Promise<GalleryState>;
  refresh(): Promise<GalleryState>;
  resolve(id: string, version: string): Promise<GalleryInstalled>;
  download(id: string, version: string, requestId: string, onProgress?: (progress: GalleryProgress) => void): Promise<GalleryInstalled>;
  cancel(requestId: string): Promise<void>;
  remove(id: string, version: string): Promise<void>;
  thumbnail(entry: GalleryEntry, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

export type GalleryErrorCode = 'invalid_catalog' | 'invalid_id' | 'unavailable' | 'download_failed'
  | 'integrity' | 'canceled' | 'storage_failed' | 'unsupported_environment';

export class GalleryError extends Error {
  constructor(public readonly code: GalleryErrorCode) {
    super(code);
    this.name = 'GalleryError';
  }
}
