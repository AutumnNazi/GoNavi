export interface BackgroundImage {
  dataUrl: string;
  name: string;
}

export type BackgroundImageErrorCode = 'invalid-type' | 'too-large' | 'invalid-image' | 'storage-failed';

export class BackgroundImageError extends Error {
  constructor(readonly code: BackgroundImageErrorCode) {
    // Callers translate the stable code rather than displaying this diagnostic.
    super(code);
    this.name = 'BackgroundImageError';
  }
}

export const BACKGROUND_IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const BACKGROUND_IMAGE_MAX_DATA_URL_CHARS = 1.5 * 1024 * 1024;
const MAX_SIDE = 1920;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32];

// Storage is untrusted: reject whitespace, URL parameters, CSS delimiters and
// noncanonical base64, even if a browser would otherwise accept them.
export const isBackgroundImageDataUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > BACKGROUND_IMAGE_MAX_DATA_URL_CHARS
    || !value.startsWith(JPEG_PREFIX)) return false;
  const payload = value.slice(JPEG_PREFIX.length);
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
  try {
    const bytes = atob(payload);
    return btoa(bytes) === payload && bytes.length >= 5
      && bytes.charCodeAt(0) === 0xff && bytes.charCodeAt(1) === 0xd8
      && bytes.charCodeAt(2) === 0xff
      && bytes.charCodeAt(bytes.length - 2) === 0xff && bytes.charCodeAt(bytes.length - 1) === 0xd9;
  } catch {
    return false;
  }
};

export const sanitizeBackgroundImage = (value: unknown): BackgroundImage | null => {
  if (!value || typeof value !== 'object') return null;
  const image = value as Record<string, unknown>;
  if (typeof image.name !== 'string' || !isBackgroundImageDataUrl(image.dataUrl)) return null;
  return { dataUrl: image.dataUrl, name: image.name };
};

const hasExpectedSignature = (bytes: Uint8Array, type: string): boolean => {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
  }
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
};

const decodeImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  const finish = (valid: boolean) => {
    image.onload = null;
    image.onerror = null;
    if (valid) resolve(image);
    else reject(new BackgroundImageError('invalid-image'));
  };
  image.onload = () => finish(Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
  image.onerror = () => finish(false);
  image.src = url;
});

const encodeImage = (image: HTMLImageElement): string => {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new BackgroundImageError('invalid-image');
    // Flatten alpha explicitly; transparent PNG/WebP must not become black JPEGs.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of JPEG_QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length > BACKGROUND_IMAGE_MAX_DATA_URL_CHARS) continue;
      if (!isBackgroundImageDataUrl(dataUrl)) throw new BackgroundImageError('invalid-image');
      return dataUrl;
    }
    throw new BackgroundImageError('too-large');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

export const prepareBackgroundImage = async (file: File): Promise<BackgroundImage> => {
  if (!ALLOWED_TYPES.has(file.type)) throw new BackgroundImageError('invalid-type');
  if (file.size > BACKGROUND_IMAGE_MAX_FILE_BYTES) throw new BackgroundImageError('too-large');
  let url: string | undefined;
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!hasExpectedSignature(header, file.type)) throw new BackgroundImageError('invalid-image');
    url = URL.createObjectURL(file);
    const image = await decodeImage(url);
    return { dataUrl: encodeImage(image), name: file.name };
  } catch (error) {
    if (error instanceof BackgroundImageError) throw error;
    throw new BackgroundImageError('invalid-image');
  } finally {
    if (url !== undefined) URL.revokeObjectURL(url);
  }
};
