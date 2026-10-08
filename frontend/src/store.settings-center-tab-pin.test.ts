import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabData } from './types';
import { buildSettingsCenterWorkbenchTab, SETTINGS_CENTER_WORKBENCH_TAB_ID } from './utils/settingsCenterTab';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

const importStore = async () => {
  const store = await import('./store');
  await store.useStore.persist.rehydrate();
  return store;
};

const table = (id: string): TabData => ({
  id,
  title: id,
  type: 'table',
  connectionId: 'conn-1',
  dbName: 'main',
  tableName: id,
});

describe('settings-center tab stays first in the workbench tab strip', () => {
  beforeAll(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    await import('./store');
    vi.unstubAllGlobals();
    vi.resetModules();
  }, 30_000);

  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('opens the settings center in front of tabs that were already open', async () => {
    const { useStore } = await importStore();
    useStore.getState().addTab(table('users'));
    useStore.getState().addTab(table('orders'));

    useStore.getState().addTab(buildSettingsCenterWorkbenchTab());

    expect(useStore.getState().tabs.map((tab) => tab.id)).toEqual([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'users', 'orders']);
    expect(useStore.getState().activeTabId).toBe(SETTINGS_CENTER_WORKBENCH_TAB_ID);
  });

  it('keeps tabs opened later behind the settings center', async () => {
    const { useStore } = await importStore();
    useStore.getState().addTab(buildSettingsCenterWorkbenchTab());
    useStore.getState().addTab(table('users'));

    expect(useStore.getState().tabs.map((tab) => tab.id)).toEqual([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'users']);
  });

  it('ignores dragging the settings center and drops other tabs right after it', async () => {
    const { useStore } = await importStore();
    useStore.getState().addTab(buildSettingsCenterWorkbenchTab());
    useStore.getState().addTab(table('users'));
    useStore.getState().addTab(table('orders'));
    const before = useStore.getState().tabs;

    useStore.getState().moveTab(SETTINGS_CENTER_WORKBENCH_TAB_ID, 'orders');
    expect(useStore.getState().tabs).toBe(before);

    useStore.getState().moveTab('orders', SETTINGS_CENTER_WORKBENCH_TAB_ID);
    expect(useStore.getState().tabs.map((tab) => tab.id)).toEqual([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'orders', 'users']);
  });

  it('puts the settings center back first when it is docked again from its own window', async () => {
    const { useStore } = await importStore();
    useStore.getState().addTab(table('users'));
    const settingsTab = buildSettingsCenterWorkbenchTab();
    // 独立窗口取消关闭时，tab 被直接追加回末尾。
    useStore.setState((state) => ({ tabs: [...state.tabs, settingsTab] }));
    useStore.getState().detachWorkbenchTab(SETTINGS_CENTER_WORKBENCH_TAB_ID);

    useStore.getState().attachWorkbenchTab(SETTINGS_CENTER_WORKBENCH_TAB_ID);

    expect(useStore.getState().tabs.map((tab) => tab.id)).toEqual([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'users']);
  });
});
