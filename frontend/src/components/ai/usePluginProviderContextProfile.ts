import { useEffect } from 'react';
import type { AIProviderConfig } from '../../types';
import type { Dispatch, SetStateAction } from 'react';
import { parseModelContextProfile, type AIModelContextProfile } from '../../utils/aiChatRuntime';
import { isPluginAIProviderNamespace } from '../../plugins/aiProvider/identity';
export function usePluginProviderContextProfile(provider: AIProviderConfig | null,
  getService: () => { AIGetModelContextProfile?: (config: AIProviderConfig) => Promise<unknown> } | undefined,
  setProfile: Dispatch<SetStateAction<AIModelContextProfile | null>>) {
  useEffect(() => {
    if (isPluginAIProviderNamespace(provider?.type)) return;
    const load = getService()?.AIGetModelContextProfile;
    if (!provider || !load) { setProfile(null); return; }
    let cancelled = false;
    void load(provider).then((value) => { if (!cancelled) setProfile(parseModelContextProfile(value)); })
      .catch(() => { if (!cancelled) setProfile(null); });
    return () => { cancelled = true; };
  }, [provider?.id, provider?.model, provider?.type, getService, setProfile]);
}
