import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginAPIError, pluginErrorText } from '../plugins/apiResult';
import { marketAPI } from './api';
import { marketErrorText } from './marketErrors';
import type { MarketPlugin, MarketSort } from './types';

export function officialFirst(items: MarketPlugin[]): MarketPlugin[] {
  return [...items].sort((a, b) => Number(b.official) - Number(a.official));
}
export function useMarketCatalog(source: string, revision: number, trustedOfficial: boolean, sourceId?: string) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MarketSort>('updated');
  const [items, setItems] = useState<MarketPlugin[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const request = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (cursor = '') => {
    if (!source) return;
    const token = ++request.current;
    pending.current = true;
    setLoading(true); setError(''); setWarning('');
    if (!cursor) { setItems([]); setNextCursor(''); setStale(false); setCachedAt(''); }
    try {
      const page = await marketAPI.catalog(query, sort, cursor);
      if (token !== request.current) return;
      if (sourceId && page.sourceId !== sourceId) throw new PluginAPIError('plugin.market.error.source_changed');
      const verifiedItems = page.items.map((plugin) => ({ ...plugin, official: trustedOfficial && plugin.official }));
      setItems((previous) => officialFirst(Array.from(new Map([...(cursor ? previous : []), ...verifiedItems].map((p) => [p.id, p])).values())));
      setNextCursor(page.nextCursor ?? '');
      const cacheWarning = page.error === 'cache_unavailable' && !page.stale;
      setStale(Boolean(page.stale)); setCachedAt(page.cachedAt ?? '');
      setWarning(cacheWarning ? marketErrorText('cache_unavailable') : '');
      setError(page.error && !cacheWarning ? marketErrorText(page.error) : '');
    } catch (cause) { if (token === request.current) setError(pluginErrorText(cause)); }
    finally { if (token === request.current) { setLoading(false); pending.current = false; } }
  }, [source, query, sort, trustedOfficial, sourceId]);
  useEffect(() => {
    setItems([]); setNextCursor(''); setLoading(false); setError(''); setWarning(''); setStale(false); setCachedAt('');
    const timer = setTimeout(() => void load(), 250);
    return () => { clearTimeout(timer); request.current++; pending.current = false; };
  }, [load, revision]);
  const more = () => { if (nextCursor && !pending.current) void load(nextCursor); };
  return { query, setQuery, sort, setSort, items, nextCursor, loading, error, warning, stale, cachedAt, reload: () => void load(), more };
}
