import { useEffect, useSyncExternalStore } from 'react';
import { getPluginDataSourceSnapshot, subscribePluginDataSources } from './snapshot';
import { retainPluginDataSourceDiscovery } from './discovery';
const getItems = () => getPluginDataSourceSnapshot().items;
export function usePluginDataSourceDiscovery(active: boolean) {
  useSyncExternalStore(subscribePluginDataSources, getItems, getItems);
  useEffect(() => active ? retainPluginDataSourceDiscovery() : undefined, [active]);
}
export function usePluginDataSources(active = true) {
  const snapshot = useSyncExternalStore(subscribePluginDataSources, getPluginDataSourceSnapshot, getPluginDataSourceSnapshot);
  useEffect(() => active ? retainPluginDataSourceDiscovery() : undefined, [active]);
  return snapshot;
}
