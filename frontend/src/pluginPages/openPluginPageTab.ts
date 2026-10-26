import { t } from '../i18n';
import { useStore } from '../store';
import type { TabData } from '../types';

export interface PluginPageTabInput {
  pluginID: string;
  pageID: string;
  title: string;
}

/** Deterministic identity: the same (plugin, page) always lands on the same tab. */
export const pluginPageTabId = (pluginID: string, pageID: string): string =>
  'plugin-page:' + pluginID + ':' + pageID;

export function buildPluginPageTab({ pluginID, pageID, title }: PluginPageTabInput): TabData {
  const label = title.trim() || t('plugin.pages.title');
  return {
    id: pluginPageTabId(pluginID, pageID),
    title: label,
    type: 'plugin-page',
    connectionId: '',
    pluginPage: { pluginID, pageID, title: label },
  };
}

/** addTab updates a tab with the same id in place, so an open page is focused, not duplicated. */
export function openPluginPageTab(input: PluginPageTabInput): void {
  useStore.getState().addTab(buildPluginPageTab(input));
}
