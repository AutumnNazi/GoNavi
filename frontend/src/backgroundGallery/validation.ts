import { BaseURL, GalleryError } from './types';
import type { GalleryAsset, GalleryCatalog, GalleryEntry } from './types';

export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRIES = 64;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 256 * 1024;
export const MAX_PIXELS = 24_000_000;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function check(value: unknown): asserts value {
  if (!value) throw new GalleryError('invalid_catalog');
}
function record(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function keys(value: Record<string, unknown>, expected: string[]) {
  check(Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}
function text(value: unknown, max: number): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
}
function webURL(value: unknown) {
  text(value, 2048);
  try {
    const url = new URL(value);
    check(url.protocol === 'https:' && !url.username && !url.password);
  } catch { throw new GalleryError('invalid_catalog'); }
}
function positive(value: unknown, max: number): asserts value is number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max);
}
export function validateSelection(id: string, version: string, allowEmptyVersion = false): void {
  if (typeof id !== 'string' || id.length > 64 || !ID.test(id)
    || typeof version !== 'string' || (!(allowEmptyVersion && version === '') && !VERSION.test(version))) {
    throw new GalleryError('invalid_id');
  }
}
export function validateAsset(value: unknown, maxBytes = MAX_IMAGE_BYTES): GalleryAsset {
  record(value);
  keys(value, ['path', 'sha256', 'sizeBytes', 'width', 'height', 'mimeType']);
  check(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256));
  const extension = value.mimeType === 'image/png' ? 'png' : value.mimeType === 'image/jpeg' ? 'jpg' : value.mimeType === 'image/webp' ? 'webp' : null;
  check(extension && value.path === 'assets/' + value.sha256 + '.' + extension);
  positive(value.sizeBytes, maxBytes);
  positive(value.width, MAX_PIXELS);
  positive(value.height, MAX_PIXELS);
  check(value.width * value.height <= MAX_PIXELS);
  return value as unknown as GalleryAsset;
}
export function validateEntry(value: unknown): GalleryEntry {
  record(value);
  keys(value, ['id', 'version', 'names', 'fit', 'image', 'thumbnail', 'attribution', 'sourceUrl', 'rightsStatus', 'license']);
  check(typeof value.id === 'string' && value.id.length <= 64 && ID.test(value.id));
  check(typeof value.version === 'string' && VERSION.test(value.version));
  check(value.fit === 'contain' || value.fit === 'cover');
  check(value.rightsStatus === 'approved');
  record(value.names);
  const names = Object.entries(value.names);
  check(names.length > 0 && names.length <= 32);
  for (const [locale, name] of names) { check(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale)); text(name, 256); }
  validateAsset(value.image);
  validateAsset(value.thumbnail, MAX_THUMBNAIL_BYTES);
  text(value.attribution, 16_384);
  webURL(value.sourceUrl);
  record(value.license);
  keys(value.license, ['id', 'name', 'url', 'notice', 'text', 'nonCommercial']);
  text(value.license.id, 128);
  text(value.license.name, 256);
  webURL(value.license.url);
  text(value.license.notice, 16_384);
  text(value.license.text, 65_536);
  check(typeof value.license.nonCommercial === 'boolean');
  return value as unknown as GalleryEntry;
}
export function validateCatalog(value: unknown): GalleryCatalog {
  record(value);
  keys(value, ['schemaVersion', 'version', 'entries']);
  check(value.schemaVersion === 1);
  check(typeof value.version === 'string' && VERSION.test(value.version));
  check(Array.isArray(value.entries) && value.entries.length <= MAX_ENTRIES);
  const ids = new Set<string>();
  for (const entry of value.entries) {
    const valid = validateEntry(entry);
    check(!ids.has(valid.id));
    ids.add(valid.id);
  }
  check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CATALOG_BYTES);
  return value as unknown as GalleryCatalog;
}
export function parseCatalog(bytes: Uint8Array): GalleryCatalog {
  check(bytes.byteLength <= MAX_CATALOG_BYTES);
  try { return validateCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch { throw new GalleryError('invalid_catalog'); }
}
export function assetURL(asset: GalleryAsset, maxBytes = MAX_IMAGE_BYTES): string {
  return BaseURL + validateAsset(asset, maxBytes).path;
}

export type ImageDimensions = { width: number; height: number };
export type ImageDecoder = (blob: Blob) => Promise<ImageDimensions>;
function intact(condition: unknown): asserts condition {
  if (!condition) throw new GalleryError('integrity');
}
function ascii(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size));
}
function pngDimensions(bytes: Uint8Array): ImageDimensions {
  intact(bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0; let height = 0; let data = false; let end = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    intact(size <= bytes.length - offset - 12 && type !== 'acTL' && type !== 'fcTL' && type !== 'fdAT');
    if (offset === 8) {
      intact(type === 'IHDR' && size === 13);
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
    } else intact(type !== 'IHDR');
    if (type === 'IDAT') data = true;
    offset += size + 12;
    if (type === 'IEND') { intact(size === 0 && offset === bytes.length); end = true; break; }
  }
  intact(data && end);
  return { width, height };
}
function jpegDimensions(bytes: Uint8Array): ImageDimensions {
  intact(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; let dimensions: ImageDimensions | undefined; let scan = false;
  while (offset + 2 <= bytes.length) {
    intact(bytes[offset++] === 255);
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) { intact(offset === bytes.length && dimensions && scan); return dimensions; }
    intact(marker !== 216 && marker !== 0 && offset + 2 <= bytes.length);
    const size = view.getUint16(offset);
    intact(size >= 2 && offset + size <= bytes.length);
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      intact([192, 193, 194].includes(marker) && size >= 8 && !dimensions);
      dimensions = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += size;
    if (marker === 218) {
      intact(dimensions); scan = true;
      // Skip entropy-coded data, preserving the next real marker for validation.
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 208 && next <= 215)) { offset += 2; continue; }
        break;
      }
    }
  }
  throw new GalleryError('integrity');
}
function webpDimensions(bytes: Uint8Array): ImageDimensions {
  intact(bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  intact(view.getUint32(4, true) + 8 === bytes.length);
  let offset = 12; let dimensions: ImageDimensions | undefined; let image = false;
  const u24 = (p: number) => bytes[p] + (bytes[p + 1] << 8) + (bytes[p + 2] << 16);
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4); const size = view.getUint32(offset + 4, true); const p = offset + 8;
    intact(size <= bytes.length - p && type !== 'ANIM' && type !== 'ANMF');
    if (type === 'VP8X') {
      intact(offset === 12 && size === 10 && (bytes[p] & 2) === 0);
      dimensions = { width: u24(p + 4) + 1, height: u24(p + 7) + 1 };
    } else if (type === 'VP8 ') {
      intact(!image && size >= 10 && (bytes[p] & 1) === 0 && bytes[p + 3] === 157 && bytes[p + 4] === 1 && bytes[p + 5] === 42);
      const frame = { width: view.getUint16(p + 6, true) & 16383, height: view.getUint16(p + 8, true) & 16383 };
      intact(!dimensions || (dimensions.width === frame.width && dimensions.height === frame.height));
      dimensions = frame; image = true;
    } else if (type === 'VP8L') {
      intact(!image && size >= 5 && bytes[p] === 47);
      const packed = view.getUint32(p + 1, true);
      intact((packed >>> 29) === 0);
      const frame = { width: (packed & 16383) + 1, height: ((packed >>> 14) & 16383) + 1 };
      intact(!dimensions || (dimensions.width === frame.width && dimensions.height === frame.height));
      dimensions = frame; image = true;
    }
    offset = p + size + (size % 2);
  }
  intact(offset === bytes.length && image && dimensions);
  return dimensions;
}
export function rasterDimensions(bytes: Uint8Array, mimeType: GalleryAsset['mimeType']): ImageDimensions {
  try {
    const result = mimeType === 'image/png' ? pngDimensions(bytes)
      : mimeType === 'image/jpeg' ? jpegDimensions(bytes) : webpDimensions(bytes);
    intact(result.width > 0 && result.height > 0 && result.width * result.height <= MAX_PIXELS);
    return result;
  } catch { throw new GalleryError('integrity'); }
}
export const decodeBrowserImage: ImageDecoder = async (blob) => {
  if (typeof globalThis.createImageBitmap !== 'function') throw new GalleryError('unsupported_environment');
  const bitmap = await globalThis.createImageBitmap(blob, { imageOrientation: 'none' });
  try { return { width: bitmap.width, height: bitmap.height }; }
  finally { bitmap.close(); }
};
export async function validateImage(blob: Blob, asset: GalleryAsset, subtle: SubtleCrypto,
  decode: ImageDecoder = decodeBrowserImage, maxBytes = MAX_IMAGE_BYTES): Promise<void> {
  validateAsset(asset, maxBytes);
  intact(blob.size === asset.sizeBytes && blob.size <= maxBytes && blob.type === asset.mimeType);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dimensions = rasterDimensions(bytes, asset.mimeType);
  intact(dimensions.width === asset.width && dimensions.height === asset.height);
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
  intact(hash === asset.sha256);
  try {
    const decoded = await decode(blob);
    intact(decoded.width === asset.width && decoded.height === asset.height);
  } catch (error) {
    if (error instanceof GalleryError) throw error;
    throw new GalleryError('integrity');
  }
}
