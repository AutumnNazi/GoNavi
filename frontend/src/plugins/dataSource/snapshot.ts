import { decodePluginDataSources } from './decode';
import type { PluginDataSourceSnapshot } from './types';

let snapshot: PluginDataSourceSnapshot = Object.freeze({ items: Object.freeze([]), loading: false, loaded: false, error: '', revision: 0 });
const listeners = new Set<() => void>();
let byType = new Map(snapshot.items.map((item) => [item.type, item]));
export const getPluginDataSourceSnapshot = () => snapshot;
export function subscribePluginDataSources(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function publish(value: Omit<PluginDataSourceSnapshot, 'revision'>): void {
  if (snapshot.items !== value.items) byType = new Map(value.items.map((item) => [item.type, item]));
  snapshot = Object.freeze({ ...value, revision: snapshot.revision + 1 });
  listeners.forEach((listener) => listener());
}
export function replacePluginDataSources(data: unknown): void {
  const decoded = decodePluginDataSources(data);
  const items = JSON.stringify(decoded) === JSON.stringify(snapshot.items) ? snapshot.items : Object.freeze(decoded.map((item) => Object.freeze(item)));
  publish({ items, loading: false, loaded: true, error: '' });
}
export function setPluginDataSourcesLoading(): void { publish({ ...snapshot, loading: true }); }
export function invalidatePluginDataSources(error: string): void {
  const items = Object.freeze(snapshot.items.map((item) => Object.freeze({ ...item, available: false, connectable: false, reason: 'catalog_error' })));
  publish({ items, loading: false, loaded: true, error });
}
export function revokePluginDataSources(pluginId: string): void {
  const items = Object.freeze(snapshot.items.map((item) => item.pluginId === pluginId
    ? Object.freeze({ ...item, available: false, connectable: false, reason: 'stopping' }) : item));
  publish({ ...snapshot, items, loading: false });
}
export const findPluginDataSource = (type: string) => byType.get(type);
