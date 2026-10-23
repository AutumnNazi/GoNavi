import { fetchPluginDataSources } from './api';
import { PluginAPIError } from '../apiResult';
import { invalidatePluginDataSources, replacePluginDataSources, setPluginDataSourcesLoading, revokePluginDataSources } from './snapshot';

let users = 0;
let epoch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let transport: Promise<void> | null = null;
let pending: Promise<void> | null = null;
let cancelPending: (() => void) | undefined;
export function refreshPluginDataSources(): Promise<void> {
  // A timed-out bridge call is fenced, not duplicated by subsequent polls.
  if (transport) return pending ?? Promise.resolve();
  const ticket = epoch;
  setPluginDataSourcesLoading();
  let deadline: ReturnType<typeof setTimeout>;
  const cancellation = new Promise<void>((resolve) => {
    cancelPending = resolve;
    deadline = setTimeout(() => {
      if (epoch === ticket) { epoch++; invalidatePluginDataSources('plugin.datasource.error.catalog_unavailable'); }
      resolve();
    }, 10000);
  });
  transport = (async () => {
    try {
      const items = await fetchPluginDataSources();
      if (epoch === ticket) replacePluginDataSources({ items });
    } catch (cause) {
      if (epoch === ticket) invalidatePluginDataSources(cause instanceof PluginAPIError ? cause.key : 'plugin.datasource.error.catalog_unavailable');
    } finally { transport = null; }
  })();
  const completion = Promise.race([transport, cancellation]).finally(() => {
    clearTimeout(deadline);
    if (pending === completion) { pending = null; cancelPending = undefined; }
  });
  pending = completion;
  return completion;
}
export function revokePluginDataSourceAvailability(pluginId: string): void {
  epoch++; cancelPending?.(); revokePluginDataSources(pluginId);
}
export function retainPluginDataSourceDiscovery(): () => void {
  if (users++ === 0) {
    void refreshPluginDataSources();
    timer = setInterval(() => void refreshPluginDataSources(), 5000);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) {
      epoch++; clearInterval(timer); timer = undefined; cancelPending?.();
      invalidatePluginDataSources('plugin.datasource.error.catalog_unavailable');
    }
  };
}
