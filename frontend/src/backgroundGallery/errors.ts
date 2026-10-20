const CODES = new Set(['invalid_catalog', 'invalid_id', 'unavailable', 'download_failed', 'integrity', 'canceled', 'storage_failed', 'unsupported_environment']);
export function galleryErrorKey(error: unknown): string {
  const value = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const code = value === 'storage-failed' ? 'storage_failed' : value;
  return 'app.theme.background.gallery.error.' + (CODES.has(code) ? code : 'download_failed');
}
