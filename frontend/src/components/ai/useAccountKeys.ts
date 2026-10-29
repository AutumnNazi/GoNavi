import { useCallback, useState } from 'react';
import { invokeAccountCommand, parseAccountKeys, type AccountKeyItem } from './aiPluginProviderAccountApi';

export interface AccountKeysView {
  state: 'loading' | 'ready' | 'error';
  items: AccountKeyItem[];
  message: string;
}

export const EMPTY_KEYS: AccountKeysView = { state: 'ready', items: [], message: '' };

export function useAccountKeys(isMounted: () => boolean) {
  const [keys, setKeys] = useState<AccountKeysView>(EMPTY_KEYS);

  const resetKeys = useCallback(() => setKeys(EMPTY_KEYS), []);

  const loadKeys = useCallback(async (pluginId: string) => {
    setKeys({ state: 'loading', items: [], message: '' });
    const outcome = await invokeAccountCommand(pluginId, 'account.keys', parseAccountKeys);
    if (!isMounted()) return;
    if (outcome.kind === 'ok') setKeys({ state: 'ready', items: outcome.data, message: '' });
    else setKeys({ state: 'error', items: [], message: outcome.kind === 'error' ? outcome.message : '' });
  }, [isMounted]);

  return { keys, loadKeys, resetKeys };
}
