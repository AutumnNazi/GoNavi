import { useCallback, useEffect, useRef, useState } from 'react';
import { packagedSkillAPI } from './api';
import { packagedSkillErrorKey } from './errors';
import { subscribePackagedSkillInvalidation } from './invalidation';
import type { PackagedSkillDescriptor } from './types';

export const SKILL_DISCOVERY_INTERVAL_MS = 5000;
export const SKILL_REQUEST_TIMEOUT_MS = 10000;
export function usePackagedSkillCatalog(active: boolean) {
  const [items, setItems] = useState<PackagedSkillDescriptor[]>([]);
  const [loading, setLoading] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const activeRef = useRef(active); activeRef.current = active;
  const epoch = useRef(0); const transport = useRef(false); const cancel = useRef<() => void>();
  const invalidate = useCallback((reason: string, pluginId?: string) => {
    setItems((current) => current.map((item) => !pluginId || item.pluginId === pluginId ? { ...item, available: false, reason } : item));
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (!activeRef.current) return Promise.resolve();
    if (transport.current) { if (!cancel.current) setError((current) => current || 'plugin.skills.error.pending'); return Promise.resolve(); }
    transport.current = true; const ticket = epoch.current; setLoading(true); setError('');
    let cancelWait: () => void = () => {};
    const cancellation = new Promise<void>((resolve) => { cancelWait = resolve; }); cancel.current = cancelWait;
    const deadline = setTimeout(() => {
      if (activeRef.current && ticket === epoch.current) {
        epoch.current++; setLoading(false); setError('plugin.skills.error.timeout'); invalidate('catalog_error');
      }
      cancelWait();
    }, SKILL_REQUEST_TIMEOUT_MS);
    const request = (async () => {
      try {
        const next = await packagedSkillAPI.list();
        if (activeRef.current && ticket === epoch.current) { setItems(next); setLoaded(true); }
      } catch (cause) {
        if (activeRef.current && ticket === epoch.current) { setError(packagedSkillErrorKey(cause)); invalidate('catalog_error'); }
      } finally { transport.current = false; }
    })();
    return Promise.race([request, cancellation]).finally(() => {
      clearTimeout(deadline); if (cancel.current === cancelWait) cancel.current = undefined;
      if (activeRef.current && ticket === epoch.current) setLoading(false);
    });
  }, [invalidate]);
  useEffect(() => {
    epoch.current++;
    if (!active) { setItems([]); setLoaded(false); setError(''); setLoading(false); return; }
    void refresh();
    const timer = setInterval(() => void refresh(), SKILL_DISCOVERY_INTERVAL_MS);
    const unsubscribe = subscribePackagedSkillInvalidation((pluginId) => {
      epoch.current++; cancel.current?.(); setLoading(false); invalidate('disabled', pluginId);
    });
    return () => { epoch.current++; cancel.current?.(); clearInterval(timer); unsubscribe(); };
  }, [active, invalidate, refresh]);
  return { items, loading, loaded, error, refresh };
}
