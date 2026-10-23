import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginErrorText } from '../plugins/apiResult';
import { marketAPI } from './api';
import type { DeviceLogin, LoginStatus, MarketSettings } from './types';

export function useMarketAccount() {
  const [settings, setSettings] = useState<MarketSettings | null>(null);
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [status, setStatus] = useState<LoginStatus | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const token = epoch.current;
    try { const value = await marketAPI.settings(); if (token === epoch.current) setSettings(value); }
    catch (cause) { if (token === epoch.current) setError(pluginErrorText(cause)); }
  }, []);
  useEffect(() => { void refresh(); return () => { epoch.current++; }; }, [refresh]);
  useEffect(() => {
    if (!login) return;
    const token = epoch.current;
    const deadline = Date.now() + login.expiresIn * 1000;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const expiryTimer = setTimeout(() => {
      if (!cancelled && token === epoch.current) { cancelled = true; clearTimeout(timer); setStatus('expired'); setLogin(null); }
    }, login.expiresIn * 1000);
    const poll = async () => {
      if (cancelled || token !== epoch.current) return;
      if (Date.now() >= deadline) { setStatus('expired'); setLogin(null); return; }
      try {
        const result = await marketAPI.pollLogin(login.deviceCode);
        if (cancelled || token !== epoch.current) return;
        if (Date.now() >= deadline) { setStatus('expired'); setLogin(null); return; }
        setStatus(result);
        if (result === 'pending') timer = setTimeout(poll, Math.min(30000, Math.max(1000, login.intervalSeconds * 1000)));
        else { setLogin(null); if (result === 'authorized') { await refresh(); setRevision((r) => r + 1); } }
      } catch (cause) { if (!cancelled && token === epoch.current) { setError(pluginErrorText(cause)); setLogin(null); } }
    };
    timer = setTimeout(poll, Math.min(30000, Math.max(1000, login.intervalSeconds * 1000)));
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(expiryTimer); };
  }, [login, refresh]);
  const cancel = () => { epoch.current++; setLogin(null); setStatus(''); setBusy(false); };
  const perform = async (action: () => Promise<void>) => {
    const token = ++epoch.current;
    setBusy(true); setError(''); setLogin(null); setStatus('');
    try { await action(); }
    catch (cause) { if (token === epoch.current) setError(pluginErrorText(cause)); }
    finally { if (token === epoch.current) setBusy(false); }
  };
  const start = () => perform(async () => {
    const token = epoch.current;
    const session = await marketAPI.login();
    if (token === epoch.current) { setLogin(session); setStatus('pending'); }
  });
  const configure = (url: string) => perform(async () => {
    const token = epoch.current;
    const value = await marketAPI.configure(url);
    if (token === epoch.current) { setSettings(value); setRevision((r) => r + 1); }
  });
  const logout = () => perform(async () => {
    const token = epoch.current;
    try { await marketAPI.logout(); }
    finally { if (token === epoch.current) { await refresh(); setRevision((r) => r + 1); } }
  });
  return { settings, login, status, error, busy, revision, start, cancel, configure, logout, refresh };
}
export type MarketAccount = ReturnType<typeof useMarketAccount>;
