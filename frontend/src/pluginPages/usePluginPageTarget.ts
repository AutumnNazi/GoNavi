import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginAPI } from '../plugins/api';
import { pluginErrorText } from '../plugins/apiResult';
import type { PluginPage, PluginStatus } from '../plugins/types';

const REFRESH_INTERVAL_MS = 3000;

export interface PluginPageTarget {
  loading: boolean;
  error: string;
  status?: PluginStatus;
  page?: PluginPage;
  available: boolean;
}

const documentHidden = (): boolean => (
  typeof document !== 'undefined' && document.visibilityState === 'hidden'
);

/**
 * Resolves one page declaration and keeps its plugin status fresh. Polling pauses while the
 * window is hidden and refreshes immediately on return, so a background page tab costs
 * nothing. Disabling, removing or replacing the plugin turns the tab into the unavailable
 * state without a remount, and the bridge stops because the host unmounts the frame.
 */
export function usePluginPageTarget(pluginID: string, pageID: string): PluginPageTarget {
  const [status, setStatus] = useState<PluginStatus | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const plugins = await pluginAPI.list();
      if (!alive.current) return;
      setStatus(plugins.find((plugin) => plugin.manifest.id === pluginID));
      setError('');
    } catch (cause) {
      if (alive.current) setError(pluginErrorText(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [pluginID]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (documentHidden()) {
        stop();
        return;
      }
      void refresh();
      start();
    };
    const onFocus = () => {
      if (!documentHidden()) void refresh();
    };
    if (!documentHidden()) start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  const page = status?.manifest.contributes?.pages?.find((candidate) => candidate.id === pageID);
  const running = status?.state === 'running' && status.desiredEnabled === true;
  return { loading, error, status, page, available: Boolean(page) && running };
}
