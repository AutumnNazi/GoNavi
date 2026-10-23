import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AIProviderConfig } from '../../types';
import type { AIModelContextProfile } from '../../utils/aiChatRuntime';
import type { CLIModelCatalog } from '../../utils/aiProviderManagement';
import { isPluginAIProviderNamespace } from '../../plugins/aiProvider/identity';
import { usePluginAIProviderCatalog } from '../../plugins/aiProvider/useCatalog';
import { subscribePluginAIInvalidation } from '../../plugins/aiProvider/invalidation';
export interface PluginModelProjectionInput {
  providers: AIProviderConfig[]; activeProvider: AIProviderConfig | null;
  setProviderModels: Dispatch<SetStateAction<Record<string, string[]>>>; setProviderCatalogs: Dispatch<SetStateAction<Record<string, CLIModelCatalog>>>;
  setDynamicModels: Dispatch<SetStateAction<string[]>>; setModelContextProfile: Dispatch<SetStateAction<AIModelContextProfile | null>>;
}
export const UNKNOWN_PLUGIN_CONTEXT = { defaultWindow: 0, options: [], unavailable: true };
export function usePluginProviderModelCatalog(input: PluginModelProjectionInput) {
  const catalog = usePluginAIProviderCatalog(input.providers.some((provider) => isPluginAIProviderNamespace(provider.type)));
  const latest = useRef(input); latest.current = input;
  useEffect(() => {
    const { providers, activeProvider, setProviderModels, setDynamicModels, setModelContextProfile } = latest.current;
    const pluginProviders = providers.filter((provider) => isPluginAIProviderNamespace(provider.type));
    if (pluginProviders.length) setProviderModels((current) => {
      const next = { ...current }; for (const provider of pluginProviders) { const source = catalog.find(provider.type); next[provider.id] = source?.available ? source.models.map((model) => model.id) : []; } return next;
    });
    if (activeProvider && isPluginAIProviderNamespace(activeProvider.type)) {
      const source = catalog.find(activeProvider.type); const model = source?.available ? source.models.find((entry) => entry.id === activeProvider.model) : undefined;
      setDynamicModels(source?.available ? source.models.map((entry) => entry.id) : []);
      setModelContextProfile(model && (!activeProvider.contextWindow || activeProvider.contextWindow <= model.contextWindow)
        ? { defaultWindow: model.contextWindow, options: [model.contextWindow] } : UNKNOWN_PLUGIN_CONTEXT);
    }
  }, [catalog.items, catalog.revision, input.providers, input.activeProvider]);
  useEffect(() => subscribePluginAIInvalidation(() => {
    latest.current.setProviderModels((current) => { const next = { ...current }; for (const provider of latest.current.providers) if (isPluginAIProviderNamespace(provider.type)) delete next[provider.id]; return next; });
    if (isPluginAIProviderNamespace(latest.current.activeProvider?.type)) { latest.current.setDynamicModels([]); latest.current.setModelContextProfile(UNKNOWN_PLUGIN_CONTEXT); }
  }), []);
  return catalog;
}
