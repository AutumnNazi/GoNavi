import { FontGalleryError } from './types';
import type { FontAsset, FontCatalog, FontEntry } from './types';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME = new Set(['font/ttf', 'font/otf', 'font/collection', 'font/woff2', 'application/font-sfnt']);

function check(value: unknown): asserts value {
  if (!value) throw new FontGalleryError('invalid_catalog');
}
function record(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown, max: number): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max);
}
function webURL(value: unknown) {
  text(value, 2048);
  try {
    const url = new URL(value);
    check(url.protocol === 'https:' && !url.username && !url.password);
  } catch { throw new FontGalleryError('invalid_catalog'); }
}
function extension(mimeType: string): string | null {
  if (mimeType === 'font/ttf' || mimeType === 'application/font-sfnt') return 'ttf';
  if (mimeType === 'font/otf') return 'otf';
  if (mimeType === 'font/collection') return 'ttc';
  if (mimeType === 'font/woff2') return 'woff2';
  return null;
}
export function validateSelection(id: string, version: string, allowEmptyVersion = false): void {
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string'
    || (!(allowEmptyVersion && version === '') && !VERSION.test(version))) {
    throw new FontGalleryError('invalid_id');
  }
}
export function validateAsset(value: unknown, maxBytes: number): FontAsset {
  record(value);
  check(typeof value.sha256 === 'string' && HASH.test(value.sha256));
  check(typeof value.mimeType === 'string' && MIME.has(value.mimeType));
  const ext = extension(String(value.mimeType));
  check(ext && value.path === 'assets/' + value.sha256 + '.' + ext);
  check(typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0 && value.sizeBytes <= maxBytes);
  return value as unknown as FontAsset;
}
export function validateEntry(value: unknown): FontEntry {
  record(value);
  check(typeof value.id === 'string' && ID.test(value.id));
  check(typeof value.version === 'string' && VERSION.test(value.version));
  check(value.kind === 'ui' || value.kind === 'mono');
  text(value.family, 128);
  check(value.rightsStatus === 'approved');
  record(value.names);
  const names = Object.entries(value.names);
  check(names.length > 0 && names.length <= 16);
  for (const [locale, name] of names) { text(locale, 32); text(name, 256); }
  text(value.description, 2048);
  text(value.useCase, 1024);
  validateAsset(value.font, 16 * 1024 * 1024);
  validateAsset(value.preview, 512 * 1024);
  text(value.attribution, 8192);
  webURL(value.sourceUrl);
  record(value.license);
  text(value.license.id, 128);
  text(value.license.name, 256);
  webURL(value.license.url);
  text(value.license.notice, 16384);
  text(value.license.text, 65536);
  check(typeof value.license.nonCommercial === 'boolean');
  return value as unknown as FontEntry;
}
export function validateCatalog(value: unknown): FontCatalog {
  record(value);
  check(value.schemaVersion === 1);
  check(typeof value.version === 'string' && VERSION.test(value.version));
  check(Array.isArray(value.entries) && value.entries.length <= 64);
  const seen = new Set<string>();
  const entries = value.entries.map((entry: unknown) => {
    const parsed = validateEntry(entry);
    if (seen.has(parsed.id)) throw new FontGalleryError('invalid_catalog');
    seen.add(parsed.id);
    return parsed;
  });
  return { schemaVersion: 1, version: String(value.version), entries };
}
