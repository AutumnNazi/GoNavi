import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginAPIError, pluginErrorText } from '../plugins/apiResult';
import { marketAPI } from './api';
import type { MarketPlugin, MarketRating } from './types';

export function useMarketDetail(id: string, sourceId?: string) {
  const [plugin, setPlugin] = useState<MarketPlugin | null>(null);
  const [ratings, setRatings] = useState<MarketRating[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const [detail, reviews] = await Promise.all([marketAPI.detail(id), marketAPI.ratings(id)]);
      if (sourceId && detail.sourceId !== sourceId) throw new PluginAPIError('plugin.market.error.source_changed');
      if (request.current === token) { setPlugin(detail); setRatings(reviews); }
    } catch (cause) { if (request.current === token) setError(pluginErrorText(cause)); }
    finally { if (request.current === token) setLoading(false); }
  }, [id, sourceId]);
  useEffect(() => { setPlugin(null); setRatings([]); void load(); return () => { request.current++; }; }, [load]);
  const saveRating = async (stars: number, body: string) => {
    if (!plugin || saving) return;
    const token = request.current;
    setSaving(true); setError('');
    try { await marketAPI.rate(id, stars, body, plugin.version); if (request.current === token) await load(); }
    catch (cause) { if (request.current === token) setError(pluginErrorText(cause)); }
    finally { setSaving(false); }
  };
  const deleteRating = async () => {
    if (saving) return;
    const token = request.current;
    setSaving(true); setError('');
    try { await marketAPI.deleteRating(id); if (request.current === token) await load(); }
    catch (cause) { if (request.current === token) setError(pluginErrorText(cause)); }
    finally { setSaving(false); }
  };
  return { plugin, ratings, error, loading, saving, load, saveRating, deleteRating };
}
