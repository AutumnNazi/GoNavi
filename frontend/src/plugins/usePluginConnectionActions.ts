import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginAPI } from './api';
import { collectPluginConnectionActions, type PluginConnectionActionEntry } from './connectionActions';
import { PLUGIN_LIFECYCLE_EVENT } from './events';

/**
 * Prefetches host connection actions once per sidebar lifetime. Plugin enable/disable
 * is refreshed on window focus and on demand; a context menu itself stays synchronous.
 */
export function usePluginConnectionActions() {
  const [actions, setActions] = useState<PluginConnectionActionEntry[]>([]);
  const loading = useRef(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const plugins = await pluginAPI.list();
      if (alive.current) setActions(collectPluginConnectionActions(plugins));
    } catch {
      if (alive.current) setActions([]);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const onFocus = () => { void reload(); };
    const onLifecycle = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(PLUGIN_LIFECYCLE_EVENT, onLifecycle);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(PLUGIN_LIFECYCLE_EVENT, onLifecycle);
    };
  }, [reload]);

  return { actions, reload };
}
