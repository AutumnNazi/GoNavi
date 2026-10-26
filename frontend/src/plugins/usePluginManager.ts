import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginAPI } from './api';
import { refreshPluginDataSources, revokePluginDataSourceAvailability } from './dataSource/discovery';
import { invalidatePackagedSkillPreviews } from './skills/invalidation';
import { invalidatePluginAIProviders } from './aiProvider/invalidation';
import { pluginErrorText } from './apiResult';
import type { PluginStatus, PluginRuntimeInfo } from './types';

export function usePluginManager() {
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);
  const [runtime, setRuntime] = useState<PluginRuntimeInfo>({ safeMode: false, managementAllowed: false, webRuntime: false });
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  const revision = useRef(0);
  const actions = useRef<Record<string, number>>({});
  const intents = useRef<Record<string, boolean>>({});
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const version = revision.current;
    try {
      const [items, info] = await Promise.all([pluginAPI.list(), pluginAPI.runtimeInfo()]);
      if (alive.current && version === revision.current) {
        setPlugins(items.map((plugin) => intents.current[plugin.manifest.id] === undefined ? plugin
          : { ...plugin, desiredEnabled: intents.current[plugin.manifest.id] }));
        setRuntime(info); setError('');
      }
    } catch (cause) { if (alive.current && version === revision.current) setError(pluginErrorText(cause)); }
    finally { refreshing.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh]);
  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const action = (actions.current[id] ?? 0) + 1;
    actions.current[id] = action;
    intents.current[id] = enabled;
    if (!enabled) { revokePluginDataSourceAvailability(id); invalidatePackagedSkillPreviews(id); invalidatePluginAIProviders({ pluginId: id, reason: 'disabled' }); }
    revision.current++;
    // Revocation is optimistic and never waits behind an enable, invocation, market call or stop.
    setRevoked((current) => { const next = new Set(current); enabled ? next.delete(id) : next.add(id); return next; });
    setPlugins((items) => items.map((p) => p.manifest.id === id ? { ...p, desiredEnabled: enabled } : p));
    setBusy((current) => ({ ...current, [id]: true }));
    setActionError('');
    try {
      const status = await pluginAPI.setEnabled(id, enabled);
      if (alive.current && actions.current[id] === action) setPlugins((items) => items.map((p) => p.manifest.id === id ? status : p));
    } catch (cause) { if (alive.current && actions.current[id] === action) setActionError(pluginErrorText(cause)); }
    finally {
      void refreshPluginDataSources();
      if (alive.current && actions.current[id] === action) { delete intents.current[id]; setBusy((current) => ({ ...current, [id]: false })); void refresh(); }
    }
  }, [refresh]);
  const remove = useCallback(async (id: string, purge: boolean) => {
    revokePluginDataSourceAvailability(id); invalidatePackagedSkillPreviews(id); invalidatePluginAIProviders({ pluginId: id, reason: 'removed' });
    revision.current++;
    const action = (actions.current[id] ?? 0) + 1;
    actions.current[id] = action;
    setBusy((current) => ({ ...current, [id]: true }));
    delete intents.current[id];
    setActionError('');
    setRevoked((current) => new Set(current).add(id));
    try {
      await pluginAPI.remove(id, purge);
      if (alive.current) setPlugins((items) => items.filter((p) => p.manifest.id !== id));
    } catch (cause) { if (alive.current) setActionError(pluginErrorText(cause)); }
    finally {
      if (alive.current && actions.current[id] === action) setBusy((current) => ({ ...current, [id]: false }));
      void refresh();
    }
  }, [refresh]);
  return { plugins, runtime, loading, error: actionError || error, busy, revoked, refresh, setEnabled, remove };
}
export type PluginManagerState = ReturnType<typeof usePluginManager>;
