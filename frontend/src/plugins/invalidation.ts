export interface PluginContributionInvalidation { pluginId?: string; reason: 'disabled' | 'removed' | 'root' }
const listeners = new Set<(event: PluginContributionInvalidation) => void>();
export function invalidatePluginContributions(event: PluginContributionInvalidation): void { listeners.forEach((listener) => listener(event)); }
export function subscribePluginContributionInvalidation(listener: (event: PluginContributionInvalidation) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
