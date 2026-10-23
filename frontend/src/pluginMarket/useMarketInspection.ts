import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginAPIError, pluginErrorText } from '../plugins/apiResult';
import { marketAPI } from './api';
import { assertInspectionQuote, assertInspectionRequest } from './inspectionQuote';
import type { MarketInspectionQuote, MarketInspectionRequest } from './types';

export function useMarketInspection(request: MarketInspectionRequest, allowed: boolean) {
  const [quote, setQuote] = useState<MarketInspectionQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const epoch = useRef(0);
  const held = useRef<MarketInspectionQuote | null>(null);
  const used = useRef(false);
  const released = useRef(new Set<string>());
  const release = useCallback((value: MarketInspectionQuote | null) => {
    if (!value || released.current.has(value.approvalToken)) return;
    released.current.add(value.approvalToken);
    // Closing never waits on cleanup. The host also expires abandoned inspection leases.
    void Promise.resolve().then(() => marketAPI.cancelInspection(value.approvalToken)).catch(() => undefined);
  }, []);
  const cancel = useCallback(() => { epoch.current++; release(held.current); held.current = null; setConsumed(true); }, [release]);
  useEffect(() => {
    const ticket = ++epoch.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    held.current = null; used.current = false;
    setQuote(null); setLoading(true); setExpired(false); setConsumed(false); setError('');
    const inspect = async () => {
      let value: MarketInspectionQuote | null = null;
      try {
        if (!allowed) throw new PluginAPIError('plugin.backend.error.management_denied');
        assertInspectionRequest(request);
        value = await marketAPI.inspect(request.id, request.version, request.artifactDigest, request.sourceId);
        if (epoch.current !== ticket) { release(value); return; }
        assertInspectionQuote(value, request);
        held.current = value; setQuote(value);
        timer = setTimeout(() => {
          if (epoch.current !== ticket) return;
          setExpired(true); setError(pluginErrorText(new PluginAPIError('plugin.market.inspection_expired')));
          release(value); held.current = null;
        }, Math.min(2147483647, Math.max(0, Date.parse(value.expiresAt) - Date.now())));
      } catch (cause) { release(value); if (epoch.current === ticket) setError(pluginErrorText(cause)); }
      finally { if (epoch.current === ticket) setLoading(false); }
    };
    void inspect();
    return () => { clearTimeout(timer); if (epoch.current === ticket) cancel(); };
  }, [request.id, request.version, request.artifactDigest, request.sourceId, allowed, cancel, release]);
  const commit = async () => {
    if (!allowed) throw new PluginAPIError('plugin.backend.error.management_denied');
    if (used.current) throw new PluginAPIError('plugin.market.inspection_used');
    const value = held.current;
    if (!value) throw new PluginAPIError('plugin.market.inspection_expired');
    try { assertInspectionQuote(value, request); }
    catch (cause) { release(value); held.current = null; setExpired(true); setError(pluginErrorText(cause)); throw cause; }
    const ticket = epoch.current;
    used.current = true; setConsumed(true); setInstalling(true);
    try { await marketAPI.install(value.inspection.manifest.id, value.inspection.manifest.version, value.artifactDigest, true, value.approvalToken); }
    finally { release(value); if (epoch.current === ticket) { held.current = null; setInstalling(false); } }
  };
  return { quote, quoteRevision: epoch.current, loading, error, expired, consumed, installing, cancel, commit, canInstall: allowed && Boolean(quote) && !expired && !consumed };
}
