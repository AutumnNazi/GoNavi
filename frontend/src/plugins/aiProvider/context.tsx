import { createContext, useContext, type ReactNode } from 'react';
import { usePluginAIProviderCatalog, type PluginAIProviderCatalog } from './useCatalog';
const Context = createContext<PluginAIProviderCatalog | null>(null);
export function AIPluginProviderScope({ active, children }: { active: boolean; children: ReactNode }) {
  const catalog = usePluginAIProviderCatalog(active);
  return <Context.Provider value={catalog}>{children}</Context.Provider>;
}
export const usePluginProviderCatalog = () => useContext(Context);
