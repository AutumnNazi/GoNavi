/** @vitest-environment jsdom */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { buildPluginPageTab, openPluginPageTab, pluginPageTabId } from './openPluginPageTab';

const originalTabs = useStore.getState().tabs;
const originalActiveTabId = useStore.getState().activeTabId;

beforeEach(() => {
  useStore.setState({ tabs: [], activeTabId: null });
});
afterAll(() => {
  useStore.setState({ tabs: originalTabs, activeTabId: originalActiveTabId });
});

describe('plugin page tabs', () => {
  it('gives one (plugin, page) pair one deterministic tab identity', () => {
    expect(pluginPageTabId('test.pages', 'overview')).toBe('plugin-page:test.pages:overview');
    const tab = buildPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: 'Overview' });
    expect(tab).toMatchObject({
      id: 'plugin-page:test.pages:overview',
      title: 'Overview',
      type: 'plugin-page',
      connectionId: '',
      pluginPage: { pluginID: 'test.pages', pageID: 'overview', title: 'Overview' },
    });
  });

  it('falls back to the localized page label when navigation has no title', () => {
    const tab = buildPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: '  ' });
    expect(tab.title.length).toBeGreaterThan(0);
    expect(tab.title).not.toBe('plugin.pages.title');
  });

  it('reuses the open page tab instead of duplicating it', () => {
    openPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: 'Overview' });
    openPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: 'Overview' });
    const state = useStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('plugin-page:test.pages:overview');
    openPluginPageTab({ pluginID: 'test.pages', pageID: 'dashboard', title: 'Dashboard' });
    expect(useStore.getState().tabs).toHaveLength(2);
  });

  it('updates an open page tab when the navigation title changes', () => {
    openPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: 'Overview' });
    openPluginPageTab({ pluginID: 'test.pages', pageID: 'overview', title: 'Overview 2' });
    const [tab] = useStore.getState().tabs;
    expect(tab.title).toBe('Overview 2');
    expect(tab.pluginPage?.title).toBe('Overview 2');
  });
});
