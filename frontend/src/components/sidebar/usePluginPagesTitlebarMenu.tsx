import { useCallback, useEffect, useRef, useState } from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { openPluginPageTab } from '../../pluginPages/openPluginPageTab';
import { pluginAPI } from '../../plugins/api';
import type { PluginRuntimeInfo, PluginStatus } from '../../plugins/types';
import type { TitleBarQuickAction } from '../TitleBarQuickActions';

export interface PluginNavigationItem {
  pluginID: string;
  pluginName: string;
  navigationID: string;
  pageID: string;
  title: string;
}

/**
 * Location=tools entries of every running plugin. Ordering stays inside one plugin so two
 * plugins never interleave; an entry whose page is not declared is ignored here even if a
 * hand-written manifest slipped through.
 */
export function collectPluginNavigation(plugins: readonly PluginStatus[]): PluginNavigationItem[] {
  const items: PluginNavigationItem[] = [];
  for (const plugin of plugins) {
    if (plugin.state !== 'running' || !plugin.desiredEnabled) continue;
    const declaredPages = new Set((plugin.manifest.contributes?.pages ?? []).map((page) => page.id));
    const entries = (plugin.manifest.contributes?.navigation ?? [])
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.location === 'tools' && declaredPages.has(entry.page))
      .sort((left, right) => (left.entry.order ?? 0) - (right.entry.order ?? 0) || left.index - right.index);
    for (const { entry } of entries) {
      items.push({
        pluginID: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        navigationID: entry.id,
        pageID: entry.page,
        title: entry.title,
      });
    }
  }
  return items;
}

/**
 * The titlebar "Plugins" menu. PluginList runs on the first open of the menu, never during
 * startup, so plugin runtime initialisation keeps its existing schedule; later opens refresh
 * the list so enable/disable/remove is reflected without restarting the window. In a web
 * session without plugin management every page call would be refused, so the menu offers no
 * actionable entry and explains why instead.
 */
export function usePluginPagesTitlebarMenu(): TitleBarQuickAction {
  const { t } = useI18n();
  const [items, setItems] = useState<PluginNavigationItem[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const alive = useRef(true);
  const loading = useRef(false);
  useEffect(() => () => {
    alive.current = false;
  }, []);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setPhase('loading');
    try {
      // Runtime gating is best effort: if it cannot be read, keep the normal menu rather
      // than hiding pages a desktop session may still serve.
      let info: PluginRuntimeInfo | null = null;
      try {
        info = await pluginAPI.runtimeInfo();
      } catch {
        info = null;
      }
      const plugins = await pluginAPI.list();
      if (!alive.current) return;
      setBlocked(info?.webRuntime === true && info.managementAllowed === false);
      setItems(collectPluginNavigation(plugins));
      setPhase('ready');
    } catch {
      if (!alive.current) return;
      setBlocked(false);
      setItems([]);
      setPhase('error');
    } finally {
      loading.current = false;
    }
  }, []);
  const menu: TitleBarQuickAction[] = blocked
    ? []
    : items.map((item) => ({
      key: 'plugin-page:' + item.pluginID + ':' + item.navigationID,
      label: item.pluginName + ' · ' + item.title,
      onClick: () => openPluginPageTab({ pluginID: item.pluginID, pageID: item.pageID, title: item.title }),
    }));
  const emptyMenuLabel = blocked
    ? t('plugin.pages.web_unavailable')
    : phase === 'loading'
      ? t('plugin.pages.loading')
      : phase === 'error'
        ? t('plugin.pages.unavailable')
        : t('plugin.pages.empty');
  return {
    key: 'plugin-pages',
    label: t('plugin.pages.menu'),
    icon: <AppstoreOutlined aria-hidden="true" />,
    dividerBefore: true,
    menu,
    emptyMenuLabel,
    onMenuOpen: () => {
      void load();
    },
  };
}
