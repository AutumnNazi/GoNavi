import { BackgroundImageError, sanitizeBackgroundImage, type BackgroundImage } from './utils/backgroundImage';
import { normalizeBackgroundPosition, type BackgroundImagePosition } from './utils/backgroundImagePosition';
import { getBuiltinBackground } from './utils/builtinBackgrounds';

export const BACKGROUND_IMAGE_STORAGE_KEY = 'gonavi-background-image-v1';
export interface BackgroundImageSnapshot extends BackgroundImagePosition {
  enabled: boolean;
  builtinId: string | null;
  builtinVersion: string;
  image: BackgroundImage | null;
  opacity: number;
}
export const defaults = (): BackgroundImageSnapshot => ({
  image: null, opacity: 15, positionX: 0, positionY: 0, enabled: false, builtinId: null, builtinVersion: '',
});
export const snapshotOf = ({ image, opacity, positionX, positionY, enabled, builtinId, builtinVersion }: BackgroundImageSnapshot): BackgroundImageSnapshot => ({
  image, opacity, positionX, positionY, enabled, builtinId, builtinVersion,
});
export const normalizeOpacity = (value: number) => Number.isFinite(value) ? Math.min(30, Math.max(5, value)) : 15;
export const validGalleryId = (id: unknown): id is string => typeof id === 'string' && id.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
export const validGalleryVersion = (version: unknown): version is string => typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version);

export function loadSnapshot(): BackgroundImageSnapshot {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem(BACKGROUND_IMAGE_STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaults();
    const snapshot = raw as Record<string, unknown>;
    if (snapshot.version !== 1) return defaults();
    const builtinVersion = validGalleryVersion(snapshot.builtinVersion) ? snapshot.builtinVersion : '';
    const builtinId = getBuiltinBackground(snapshot.builtinId)?.id
      ?? (builtinVersion && validGalleryId(snapshot.builtinId) ? snapshot.builtinId : null);
    const image = builtinId ? null : sanitizeBackgroundImage(snapshot.image);
    if (!builtinId && snapshot.image != null && !image) return defaults();
    const selected = Boolean(image || builtinId);
    return {
      image, builtinId, builtinVersion: builtinId ? builtinVersion : '',
      enabled: selected && snapshot.enabled === true,
      opacity: typeof snapshot.opacity === 'number' ? normalizeOpacity(snapshot.opacity) : 15,
      ...normalizeBackgroundPosition(selected ? snapshot.positionX : 0, selected ? snapshot.positionY : 0),
    };
  } catch { return defaults(); }
}

export function persistSnapshot(snapshot: BackgroundImageSnapshot): void {
  try {
    const { builtinVersion, ...legacy } = snapshot;
    // Preserve the v1 envelope and avoid serializing any transient resource URL.
    globalThis.localStorage.setItem(BACKGROUND_IMAGE_STORAGE_KEY, JSON.stringify({
      version: 1, ...legacy, ...(builtinVersion ? { builtinVersion } : {}),
    }));
  } catch { throw new BackgroundImageError('storage-failed'); }
}
