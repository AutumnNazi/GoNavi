import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginAPIError } from '../apiResult';
import { subscribePluginContributionInvalidation } from '../invalidation';
import { isWebRuntime } from '../../utils/browserFileTransfer';
import { fetchPluginExporters } from './api';
import { exporterSnapshotKey } from './decode';
import type { PluginExporterCatalog } from './types';
const EMPTY: PluginExporterCatalog = Object.freeze({ items: Object.freeze([]), truncated: false });
export interface ExporterChoice { readonly format: string; readonly snapshotKey: string; readonly epoch: number }
export function usePluginExporterCatalog(enabled: boolean) {
  const active = enabled && !isWebRuntime(); const [catalog, setCatalog] = useState(EMPTY); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false); const [epochValue, setEpoch] = useState(0);
  const current = useRef({ active, catalog: EMPTY, epoch: 0, loaded: false }); current.current.active = active;
  const transport = useRef(false); const cancelWait = useRef<() => void>();
  const commit = useCallback((next: PluginExporterCatalog) => { if (JSON.stringify(next) !== JSON.stringify(current.current.catalog)) { current.current.catalog = next; setCatalog(next); } }, []);
  const invalidate = useCallback((pluginId?: string) => {
    current.current.epoch++; setEpoch(current.current.epoch); cancelWait.current?.(); setLoading(false);
    commit(Object.freeze({ ...current.current.catalog, items: Object.freeze(current.current.catalog.items.map((item) => !pluginId || item.pluginId === pluginId ? Object.freeze({ ...item, available: false, reason: 'runtime_unavailable' }) : item)) }));
  }, [commit]);
  const refresh = useCallback((background = false): Promise<void> => {
    if (!current.current.active || transport.current) return Promise.resolve();
    const ticket = current.current.epoch; transport.current = true;
    if (!background || !current.current.loaded) setLoading(true);
    let endWait: () => void = () => {}; const cancellation = new Promise<void>((resolve) => { endWait = resolve; }); cancelWait.current = endWait;
    const deadline = setTimeout(() => { if (ticket === current.current.epoch && current.current.active) { invalidate(); setError('plugin.exporter.error.catalog_timeout'); } endWait(); }, 10000);
    const request = (async () => {
      try {
        const next = await fetchPluginExporters();
        if (ticket === current.current.epoch && current.current.active) { commit(next); setLoaded(true); current.current.loaded = true; setError(''); }
      } catch (cause) {
        if (ticket === current.current.epoch && current.current.active) { invalidate(); setError(cause instanceof PluginAPIError ? cause.key : 'plugin.exporter.error.catalog'); }
      } finally { transport.current = false; }
    })();
    return Promise.race([request, cancellation]).finally(() => { clearTimeout(deadline); if (cancelWait.current === endWait) cancelWait.current = undefined; if (ticket === current.current.epoch && current.current.active) setLoading(false); });
  }, [commit, invalidate]);
  useEffect(() => {
    current.current.epoch++; setEpoch(current.current.epoch);
    if (!active) { cancelWait.current?.(); commit(EMPTY); setLoading(false); setLoaded(false); current.current.loaded = false; return; }
    void refresh(); const timer = setInterval(() => void refresh(true), 5000);
    const unsubscribe = subscribePluginContributionInvalidation((event) => invalidate(event.reason === 'root' ? undefined : event.pluginId));
    return () => { current.current.epoch++; cancelWait.current?.(); clearInterval(timer); unsubscribe(); };
  }, [active, commit, invalidate, refresh]);
  const choose = useCallback((format: string): ExporterChoice | null => {
    const item = current.current.catalog.items.find((entry) => entry.format === format);
    return current.current.active && item?.available ? Object.freeze({ format, snapshotKey: exporterSnapshotKey(item), epoch: current.current.epoch }) : null;
  }, []);
  const isCurrent = useCallback((choice: ExporterChoice | null): boolean => {
    if (!choice || !current.current.active || current.current.epoch !== choice.epoch) return false;
    const item = current.current.catalog.items.find((entry) => entry.format === choice.format);
    return item?.available === true && choice.snapshotKey === exporterSnapshotKey(item);
  }, []);
  return { ...catalog, loading, loaded, error, epoch: epochValue, choose, isCurrent, refresh };
}
