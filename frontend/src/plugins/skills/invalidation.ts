type SkillInvalidationListener = (pluginId: string) => void;
const listeners = new Set<SkillInvalidationListener>();
// Invalidate local previews synchronously. This bus never fetches documents or activates plugins.
export function invalidatePackagedSkillPreviews(pluginId: string): void { listeners.forEach((listener) => listener(pluginId)); }
export function subscribePackagedSkillInvalidation(listener: SkillInvalidationListener): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
