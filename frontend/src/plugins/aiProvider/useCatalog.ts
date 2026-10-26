import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginAPIError } from '../apiResult';
import { fetchPluginAIProviders } from './api';
import { pluginAIProviderSnapshotKey } from './decode';
import { subscribePluginAIInvalidation } from './invalidation';
import type { PluginAIProviderView } from './types';

export interface PluginAIProviderPin { type: string; snapshot: string; epoch: number }
const EMPTY: readonly PluginAIProviderView[] = Object.freeze([]);
export function usePluginAIProviderCatalog(active: boolean) {
  const [items, setItems] = useState(EMPTY); const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const latest = useRef({ active, items: EMPTY, loaded: false }); latest.current.active = active;
  const epoch = useRef(0); const transport = useRef(false); const cancel = useRef<() => void>();
  const commit = useCallback((next: readonly PluginAIProviderView[]) => {
    if (JSON.stringify(latest.current.items) !== JSON.stringify(next)) { latest.current.items = next; setItems(next); }
  }, []);
  const revoke = useCallback((reason: string, pluginId?: string) => {
    epoch.current++; cancel.current?.(); setLoading(false); setRevision((value) => value + 1);
    commit(latest.current.items.map((item) => !pluginId || item.pluginId === pluginId ? { ...item, available: false, reason } : item));
  }, [commit]);
  const refresh = useCallback((background = false): Promise<void> => {
    if (!latest.current.active || transport.current) return Promise.resolve();
    const ticket = epoch.current; transport.current = true;
    if (!background || !latest.current.loaded) setLoading(true);
    let cancelWait: () => void = () => {};
    const cancellation = new Promise<void>((resolve) => { cancelWait = resolve; }); cancel.current = cancelWait;
    const deadline = setTimeout(() => { if (ticket === epoch.current && latest.current.active) { revoke('runtime_unavailable'); setError('plugin.ai_provider.error.timeout'); } cancelWait(); }, 10000);
    const request = (async () => {
      try {
        const next = await fetchPluginAIProviders();
        if (ticket === epoch.current && latest.current.active) { commit(next); latest.current.loaded = true; setLoaded(true); setError(''); }
      } catch (cause) {
        if (ticket === epoch.current && latest.current.active) { revoke('runtime_unavailable'); setError(cause instanceof PluginAPIError ? cause.key : 'plugin.ai_provider.error.catalog_unavailable'); }
      } finally { transport.current = false; }
    })();
    return Promise.race([request, cancellation]).finally(() => {
      clearTimeout(deadline); if (cancel.current === cancelWait) cancel.current = undefined;
      if (ticket === epoch.current && latest.current.active) setLoading(false);
    });
  }, [commit, revoke]);
  useEffect(() => {
    epoch.current++;
    if (!active) { commit(EMPTY); latest.current.loaded = false; setLoaded(false); setLoading(false); setError(''); return; }
    void refresh(); const interval = setInterval(() => void refresh(true), 5000);
    const unsubscribe = subscribePluginAIInvalidation((event) => { revoke(event.reason, event.pluginId); });
    return () => { epoch.current++; cancel.current?.(); clearInterval(interval); unsubscribe(); };
  }, [active, commit, refresh, revoke]);
  const find = useCallback((type: string) => latest.current.items.find((item) => item.type === type), []);
  const capture = useCallback((type: string): PluginAIProviderPin | null => {
    const item = find(type); return item?.available && latest.current.active ? { type, epoch: epoch.current, snapshot: pluginAIProviderSnapshotKey(item) } : null;
  }, [find]);
  const isCurrent = useCallback((pin: PluginAIProviderPin | null) => Boolean(pin && pin.epoch === epoch.current && latest.current.active
    && find(pin.type)?.available && pin.snapshot === pluginAIProviderSnapshotKey(find(pin.type))), [find]);
  return { items, loading, loaded, error, revision, find, capture, isCurrent, refresh };
}
export type PluginAIProviderCatalog = ReturnType<typeof usePluginAIProviderCatalog>;
