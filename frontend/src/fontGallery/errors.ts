const CODES = new Set(['invalid_catalog', 'invalid_id', 'unavailable', 'download_failed', 'integrity', 'canceled', 'storage_failed', 'unsupported_environment', 'preview_failed']);
export function fontGalleryErrorKey(error: unknown): string {
  const value = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const code = CODES.has(value) ? value : 'download_failed';
  return 'app.theme.font_family.gallery.error.' + code;
}
