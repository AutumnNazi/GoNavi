import { PluginAPIError, requireRecord } from '../plugins/apiResult';
import { decodeCatalog } from './decode';
import type { CatalogPage } from './types';

// Preserve only explicitly marked partial results: stale cache or fresh data whose cache write failed.
export async function marketCatalogResult(call: Promise<unknown>): Promise<CatalogPage> {
  const result = requireRecord(await call);
  if (result.success === true) return decodeCatalog(result.data);
  if (result.success === false && result.data != null) {
    const data = requireRecord(result.data);
    if (data.stale === true || (data.stale === false && data.error === 'cache_unavailable')) {
      const page = decodeCatalog(data);
      return { ...page, error: page.error || 'request_failed' };
    }
  }
  throw new PluginAPIError('plugin.backend.error.market_unavailable', typeof result.message === 'string' ? result.message.slice(0, 2048) : '');
}
