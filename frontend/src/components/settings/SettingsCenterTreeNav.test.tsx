/** @vitest-environment jsdom */

import React, { act as reactAct } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { t } from '../../i18n';

vi.mock('@ant-design/icons', () => ({
  CaretRightOutlined: () => React.createElement('span', { 'data-tree-caret': 'true' }),
  SearchOutlined: () => React.createElement('span', { 'data-tree-search-icon': 'true' }),
  CloseCircleFilled: () => React.createElement('span', { 'data-tree-search-clear': 'true' }),
}));

import SettingsCenterTreeNav, {
  SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY,
  flattenVisibleSettingsCenterTree,
  focusSettingsCenterTreeNode,
  nextSettingsCenterTreeFocusIndex,
  settingsCenterTreeNodeId,
} from './SettingsCenterTreeNav';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ensureLocalStorage = () => {
  if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage.clear === 'function') {
    return;
  }
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
};

const overlayTheme = buildOverlayWorkbenchTheme(false);

const createGroups = (onLanguageClick = vi.fn(), onProxyClick = vi.fn()) => ([
  {
    key: 'preferences',
    icon: <span>P</span>,
    title: '偏好设置',
    description: '语言与外观',
    items: [
      {
        key: 'language',
        icon: <span>L</span>,
        title: '语言',
        description: '界面语言',
        onClick: onLanguageClick,
      },
      {
        key: 'theme',
        icon: <span>T</span>,
        title: '主题',
        description: '外观主题',
        onClick: vi.fn(),
      },
    ],
  },
  {
    key: 'services',
    icon: <span>S</span>,
    title: '服务配置',
    description: '代理与下载',
    items: [
      {
        key: 'proxy',
        icon: <span>X</span>,
        title: '代理',
        description: '网络代理',
        onClick: onProxyClick,
      },
    ],
  },
]);

describe('SettingsCenterTreeNav', () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('flattens expanded groups and hides collapsed children', () => {
    const groups = createGroups();
    const expanded = flattenVisibleSettingsCenterTree(groups, new Set());
    expect(expanded.map((node) => node.id)).toEqual([
      'group:preferences',
      'item:preferences:language',
      'item:preferences:theme',
      'group:services',
      'item:services:proxy',
    ]);

    const collapsed = flattenVisibleSettingsCenterTree(groups, new Set(['group:services']));
    expect(collapsed.map((node) => node.id)).toEqual([
      'group:preferences',
      'item:preferences:language',
      'item:preferences:theme',
      'group:services',
    ]);
    expect(settingsCenterTreeNodeId({ type: 'item', groupKey: 'preferences', itemKey: 'language' }))
      .toBe('item:preferences:language');
  });

  it('starts with expandable groups collapsed on first visit', () => {
    const onLanguageClick = vi.fn();
    const onSelectGroup = vi.fn();
    const renderer = create(
      <SettingsCenterTreeNav
        groups={createGroups(onLanguageClick)}
        activeGroupKey="preferences"
        activeItemKey="language"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={onSelectGroup}
      />,
    );

    const tree = renderer.root.findByProps({ role: 'tree' });
    expect(tree.props['aria-label']).toBe('设置中心');
    expect(renderer.root.findAllByProps({ role: 'treeitem' })).toHaveLength(2);
    expect(renderer.root.findAllByProps({ 'data-settings-pane-key': 'language' })).toHaveLength(0);

    const preferencesGroup = renderer.root.findByProps({ 'data-settings-tree-node': 'group:preferences' });
    expect(preferencesGroup.props['aria-expanded']).toBe(false);

    const caret = renderer.root.findByProps({ 'data-settings-tree-toggle': 'group:preferences' });
    act(() => {
      caret.props.onClick({ stopPropagation() { /* caret should not bubble to the group */ } });
    });

    expect(renderer.root.findAllByProps({ role: 'treeitem' })).toHaveLength(4);
    const languageNode = renderer.root.findByProps({ 'data-settings-pane-key': 'language' });
    expect(languageNode.props['aria-selected']).toBe(true);
    expect(languageNode.props.className).toContain('is-active');
    expect(renderer.root.findAllByProps({ className: 'gonavi-settings-center-tree-icon' })).toHaveLength(0);

    act(() => {
      languageNode.props.onClick();
    });
    expect(onLanguageClick).toHaveBeenCalledTimes(1);
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  it('collapses a group from the caret without changing the selected leaf', () => {
    const onSelectGroup = vi.fn();
    const renderer = create(
      <SettingsCenterTreeNav
        groups={createGroups()}
        activeGroupKey="preferences"
        activeItemKey="language"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={onSelectGroup}
      />,
    );

    const preferencesGroup = renderer.root.findByProps({ 'data-settings-tree-node': 'group:preferences' });
    expect(preferencesGroup.props['aria-expanded']).toBe(false);
    const caret = renderer.root.findByProps({ 'data-settings-tree-toggle': 'group:preferences' });

    act(() => {
      caret.props.onClick({ stopPropagation() { /* caret should not bubble to the group */ } });
    });
    expect(renderer.root.findByProps({ 'data-settings-tree-node': 'group:preferences' }).props['aria-expanded']).toBe(true);
    expect(renderer.root.findAllByProps({ 'data-settings-pane-key': 'language' })).toHaveLength(1);

    act(() => {
      caret.props.onClick({ stopPropagation() { /* caret should not bubble to the group */ } });
    });

    const collapsedGroup = renderer.root.findByProps({ 'data-settings-tree-node': 'group:preferences' });
    expect(collapsedGroup.props['aria-expanded']).toBe(false);
    expect(renderer.root.findAllByProps({ 'data-settings-pane-key': 'language' })).toHaveLength(0);
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  it('remembers expanded groups across remounts via localStorage', () => {
    const groups = createGroups();
    const first = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="preferences"
        activeItemKey="language"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={vi.fn()}
      />,
    );

    expect(first.root.findByProps({ 'data-settings-tree-node': 'group:preferences' }).props['aria-expanded']).toBe(false);
    expect(first.root.findByProps({ 'data-settings-tree-node': 'group:services' }).props['aria-expanded']).toBe(false);

    act(() => {
      first.root.findByProps({ 'data-settings-tree-toggle': 'group:preferences' }).props.onClick({
        stopPropagation() { /* caret */ },
      });
    });
    expect(first.root.findByProps({ 'data-settings-tree-node': 'group:preferences' }).props['aria-expanded']).toBe(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY) ?? 'null')).toEqual([
      'group:preferences',
    ]);

    act(() => {
      first.unmount();
    });

    const second = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="preferences"
        activeItemKey="language"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={vi.fn()}
      />,
    );

    expect(second.root.findByProps({ 'data-settings-tree-node': 'group:preferences' }).props['aria-expanded']).toBe(true);
    expect(second.root.findByProps({ 'data-settings-tree-node': 'group:services' }).props['aria-expanded']).toBe(false);
    expect(second.root.findAllByProps({ 'data-settings-pane-key': 'language' })).toHaveLength(1);
    expect(second.root.findAllByProps({ 'data-settings-pane-key': 'proxy' })).toHaveLength(0);
  });

  it('activates another group from the tree instead of requiring a settings list', () => {
    const onSelectGroup = vi.fn();
    const renderer = create(
      <SettingsCenterTreeNav
        groups={createGroups()}
        activeGroupKey="preferences"
        activeItemKey="language"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={onSelectGroup}
      />,
    );

    const servicesGroup = renderer.root.findByProps({ 'data-settings-tree-node': 'group:services' });
    act(() => {
      servicesGroup.props.onClick();
    });
    expect(onSelectGroup).toHaveBeenCalledWith('services');
  });

  it('exposes nested section leaves under a settings node', () => {
    const onThemeClick = vi.fn();
    const onAppearanceClick = vi.fn();
    const groups = [{
      key: 'preferences',
      icon: <span>P</span>,
      title: '偏好设置',
      description: '语言与外观',
      items: [{
        key: 'theme',
        icon: <span>T</span>,
        title: '主题与外观',
        description: '主题设置',
        onClick: onThemeClick,
        children: [
          {
            key: 'theme-theme',
            icon: <span>I</span>,
            title: '主题与界面',
            description: '亮暗模式',
            onClick: vi.fn(),
          },
          {
            key: 'theme-appearance',
            icon: <span>F</span>,
            title: '显示与字体',
            description: '缩放字体',
            onClick: onAppearanceClick,
          },
          {
            key: 'theme-workspace',
            icon: <span>W</span>,
            title: '工作区',
            description: '工作区',
            onClick: vi.fn(),
          },
        ],
      }],
    }];

    expect(flattenVisibleSettingsCenterTree(groups, new Set()).map((node) => node.id)).toEqual([
      'group:preferences',
      'item:preferences:theme',
      'item:preferences:theme-theme',
      'item:preferences:theme-appearance',
      'item:preferences:theme-workspace',
    ]);
    expect(flattenVisibleSettingsCenterTree(groups, new Set(['item:preferences:theme'])).map((node) => node.id)).toEqual([
      'group:preferences',
      'item:preferences:theme',
    ]);

    localStorage.setItem(
      SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY,
      JSON.stringify(['group:preferences', 'item:preferences:theme']),
    );

    const renderer = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="preferences"
        activeItemKey="theme-appearance"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={() => undefined}
      />,
    );

    expect(renderer.root.findAllByProps({ role: 'treeitem' })).toHaveLength(5);
    expect(renderer.root.findAllByProps({ className: 'gonavi-settings-center-tree-icon' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'gonavi-settings-center-tree-branch' })).toHaveLength(1);
    const appearanceNode = renderer.root.findByProps({ 'data-settings-pane-key': 'theme-appearance' });
    expect(appearanceNode.props.className).toContain('is-grandchild');
    expect(appearanceNode.props['aria-selected']).toBe(true);
    act(() => {
      appearanceNode.props.onClick();
    });
    expect(onAppearanceClick).toHaveBeenCalledTimes(1);

    const themeNode = renderer.root.findByProps({ 'data-settings-pane-key': 'theme' });
    act(() => {
      themeNode.props.onClick();
    });
    expect(onThemeClick).toHaveBeenCalledTimes(1);
  });

  it('exposes a fourth-level leaf under a nested settings node', () => {
    const onConnectedClick = vi.fn();
    const groups = [{
      key: 'services',
      title: '服务配置',
      description: '服务',
      items: [{
        key: 'ai',
        title: 'AI 设置',
        description: 'AI',
        onClick: vi.fn(),
        children: [{
          key: 'ai-providers',
          title: '模型供应商',
          description: '供应商',
          onClick: vi.fn(),
          children: [{
            key: 'ai-providers-connected',
            title: '已接入',
            description: '已保存配置',
            onClick: onConnectedClick,
          }],
        }],
      }],
    }];

    expect(flattenVisibleSettingsCenterTree(groups, new Set()).map((node) => node.id)).toEqual([
      'group:services',
      'item:services:ai',
      'item:services:ai-providers',
      'item:services:ai-providers-connected',
    ]);

    localStorage.setItem(
      SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY,
      JSON.stringify(['group:services', 'item:services:ai', 'item:services:ai-providers']),
    );

    const renderer = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="services"
        activeItemKey="ai-providers-connected"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={() => undefined}
      />,
    );

    const connectedNode = renderer.root.findByProps({ 'data-settings-pane-key': 'ai-providers-connected' });
    expect(connectedNode.props.className).toContain('is-great-grandchild');
    expect(connectedNode.props['aria-selected']).toBe(true);
    act(() => {
      connectedNode.props.onClick();
    });
    expect(onConnectedClick).toHaveBeenCalledTimes(1);
  });


  it('auto-expands ancestors when an active nested item is selected programmatically', () => {
    const groups = [{
      key: 'services',
      title: '服务配置',
      description: '服务',
      items: [{
        key: 'ai',
        title: 'AI 设置',
        description: 'AI',
        onClick: vi.fn(),
        children: [{
          key: 'ai-providers',
          title: '模型供应商',
          description: '供应商',
          onClick: vi.fn(),
        }],
      }],
    }];

    // First visit: everything starts collapsed in storage default.
    localStorage.removeItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY);

    const renderer = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="services"
        activeItemKey="ai-providers"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={() => undefined}
      />,
    );

    expect(renderer.root.findByProps({ 'data-settings-tree-node': 'group:services' }).props['aria-expanded']).toBe(true);
    expect(renderer.root.findByProps({ 'data-settings-tree-node': 'item:services:ai' }).props['aria-expanded']).toBe(true);
    const providersNode = renderer.root.findByProps({ 'data-settings-pane-key': 'ai-providers' });
    expect(providersNode.props['aria-selected']).toBe(true);
  });

  it('renders a leaf group as a first-level node without a nested child', () => {
    const onSelectGroup = vi.fn();
    const groups = [{
      key: 'about',
      title: '关于 GoNavi',
      description: '版本与更新',
      items: [],
    }];

    expect(flattenVisibleSettingsCenterTree(groups, new Set()).map((node) => node.id)).toEqual([
      'group:about',
    ]);

    const renderer = create(
      <SettingsCenterTreeNav
        groups={groups}
        activeGroupKey="about"
        activeItemKey="about-go-navi"
        darkMode={false}
        overlayTheme={overlayTheme}
        ariaLabel="设置中心"
        onSelectGroup={onSelectGroup}
      />,
    );

    expect(renderer.root.findAllByProps({ role: 'treeitem' })).toHaveLength(1);
    const aboutNode = renderer.root.findByProps({ 'data-settings-tree-node': 'group:about' });
    expect(aboutNode.props['aria-selected']).toBe(true);
    expect(aboutNode.props['aria-expanded']).toBeUndefined();
    expect(aboutNode.props['aria-label']).toBe('关于 GoNavi');
    expect(renderer.root.findAllByProps({ 'data-settings-pane-key': 'about-go-navi' })).toHaveLength(0);

    act(() => {
      aboutNode.props.onClick();
    });
    expect(onSelectGroup).not.toHaveBeenCalled();
  });
});

const pressKey = (target: EventTarget | null, key: string) => {
  expect(target).toBeTruthy();
  reactAct(() => {
    (target as Element).dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
  });
};

const treeNode = (container: HTMLElement, id: string) => {
  const node = container.querySelector(`[data-settings-tree-node="${id}"]`);
  expect(node).toBeInstanceOf(HTMLElement);
  return node as HTMLElement;
};

describe('SettingsCenterTreeNav keyboard focus', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    localStorage.setItem(
      SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY,
      JSON.stringify(['group:preferences', 'group:services']),
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    reactAct(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    localStorage.clear();
  });

  it('focusSettingsCenterTreeNode no-ops without a tree or matching node', () => {
    expect(focusSettingsCenterTreeNode(null, 'group:preferences')).toBeNull();
    expect(focusSettingsCenterTreeNode(undefined, 'group:preferences')).toBeNull();
    const tree = document.createElement('div');
    expect(focusSettingsCenterTreeNode(tree, 'group:preferences')).toBeNull();
  });

  it('focusSettingsCenterTreeNode focuses the matching tree item', () => {
    const tree = document.createElement('div');
    const node = document.createElement('div');
    node.setAttribute('data-settings-tree-node', 'group:preferences');
    node.tabIndex = -1;
    tree.append(node);
    document.body.append(tree);
    expect(focusSettingsCenterTreeNode(tree, 'group:preferences')).toBe(node);
    expect(document.activeElement).toBe(node);
    tree.remove();
  });

  it('computes wrapped and fallback focus indices', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextSettingsCenterTreeFocusIndex([], 'a', 1)).toBeNull();
    expect(nextSettingsCenterTreeFocusIndex(nodes, 'missing', 1)).toBe(0);
    expect(nextSettingsCenterTreeFocusIndex(nodes, 'a', 1)).toBe(1);
    expect(nextSettingsCenterTreeFocusIndex(nodes, 'c', 1)).toBe(0);
    expect(nextSettingsCenterTreeFocusIndex(nodes, 'a', -1)).toBe(2);
  });

  it('advances two items with consecutive ArrowDown and keeps document.activeElement in sync', () => {
    const onLanguageClick = vi.fn();
    const onThemeClick = vi.fn();
    const groups = createGroups(onLanguageClick);
    groups[0].items[1].onClick = onThemeClick;

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="preferences"
          activeItemKey={null}
          darkMode
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const group = treeNode(container!, 'group:preferences');
    reactAct(() => {
      group.focus();
    });
    expect(document.activeElement).toBe(group);
    expect(group.tabIndex).toBe(0);

    pressKey(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:language'));
    expect(treeNode(container!, 'item:preferences:language').tabIndex).toBe(0);
    expect(treeNode(container!, 'group:preferences').tabIndex).toBe(-1);
    expect(onLanguageClick).toHaveBeenCalledTimes(1);

    pressKey(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:theme'));
    expect(treeNode(container!, 'item:preferences:theme').tabIndex).toBe(0);
    expect(onThemeClick).toHaveBeenCalledTimes(1);

    pressKey(document.activeElement, 'Enter');
    expect(onThemeClick).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:theme'));
  });

  it('continues from the real DOM focus after programmatic selection changes', () => {
    const onLanguageClick = vi.fn();
    const groups = createGroups(onLanguageClick);

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="preferences"
          activeItemKey={null}
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const group = treeNode(container!, 'group:preferences');
    reactAct(() => {
      group.focus();
    });

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="services"
          activeItemKey="proxy"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });
    expect(document.activeElement).toBe(group);
    expect(group.tabIndex).toBe(0);
    expect(treeNode(container!, 'item:services:proxy').tabIndex).toBe(-1);

    pressKey(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:language'));
    expect(onLanguageClick).toHaveBeenCalledTimes(1);
  });

  it('activates the keyboard-focused leaf with Space and wraps ArrowUp', () => {
    const onLanguageClick = vi.fn();
    const onProxyClick = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups(onLanguageClick, onProxyClick)}
          activeGroupKey="preferences"
          activeItemKey="language"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const language = treeNode(container!, 'item:preferences:language');
    reactAct(() => {
      language.focus();
    });
    pressKey(document.activeElement, ' ');
    expect(onLanguageClick).toHaveBeenCalledTimes(1);

    pressKey(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));

    pressKey(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(treeNode(container!, 'item:services:proxy'));
  });

  it('jumps with Home/End and ignores unrelated keys', () => {
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups()}
          activeGroupKey="preferences"
          activeItemKey="language"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const language = treeNode(container!, 'item:preferences:language');
    reactAct(() => {
      language.focus();
    });
    pressKey(document.activeElement, 'End');
    expect(document.activeElement).toBe(treeNode(container!, 'item:services:proxy'));

    pressKey(document.activeElement, 'Home');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));

    pressKey(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));
  });

  it('expands, moves into, and collapses groups with horizontal arrows', () => {
    localStorage.setItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY, JSON.stringify([]));
    const onSelectGroup = vi.fn();
    const onLanguageClick = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups(onLanguageClick)}
          activeGroupKey="services"
          activeItemKey="proxy"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={onSelectGroup}
        />,
      );
    });

    const group = treeNode(container!, 'group:preferences');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    reactAct(() => {
      group.focus();
    });

    pressKey(document.activeElement, 'ArrowRight');
    expect(treeNode(container!, 'group:preferences').getAttribute('aria-expanded')).toBe('true');
    expect(container!.querySelector('[data-settings-pane-key="language"]')).not.toBeNull();

    pressKey(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:language'));
    expect(onLanguageClick).toHaveBeenCalledTimes(1);

    pressKey(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));

    pressKey(document.activeElement, 'ArrowLeft');
    expect(treeNode(container!, 'group:preferences').getAttribute('aria-expanded')).toBe('false');
    expect(container!.querySelector('[data-settings-pane-key="language"]')).toBeNull();

    pressKey(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));

    pressKey(document.activeElement, 'Enter');
    expect(treeNode(container!, 'group:preferences').getAttribute('aria-expanded')).toBe('true');
    expect(onSelectGroup).toHaveBeenCalledWith('preferences');
  });

  it('moves nested keyboard focus to the parent item and activates another group', () => {
    const onThemeClick = vi.fn();
    const onAppearanceClick = vi.fn();
    const onSelectGroup = vi.fn();
    const groups = [{
      key: 'preferences',
      title: '偏好设置',
      description: '语言与外观',
      items: [{
        key: 'theme',
        title: '主题与外观',
        description: '主题设置',
        onClick: onThemeClick,
        children: [
          {
            key: 'theme-appearance',
            title: '显示与字体',
            description: '缩放字体',
            onClick: onAppearanceClick,
          },
        ],
      }],
    }, {
      key: 'services',
      title: '服务配置',
      description: '代理与下载',
      items: [{
        key: 'proxy',
        title: '代理',
        description: '网络代理',
        onClick: vi.fn(),
      }],
    }];
    localStorage.setItem(
      SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY,
      JSON.stringify(['group:preferences', 'item:preferences:theme', 'group:services']),
    );

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="preferences"
          activeItemKey="theme-appearance"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={onSelectGroup}
        />,
      );
    });

    const appearance = treeNode(container!, 'item:preferences:theme-appearance');
    reactAct(() => {
      appearance.focus();
    });
    pressKey(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:theme'));

    pressKey(document.activeElement, 'Enter');
    expect(onThemeClick).toHaveBeenCalledTimes(1);
    expect(treeNode(container!, 'item:preferences:theme').getAttribute('aria-expanded')).toBe('true');

    pressKey(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(treeNode(container!, 'item:preferences:theme-appearance'));

    const leaf = treeNode(container!, 'item:preferences:theme-appearance');
    pressKey(leaf, 'ArrowRight');
    expect(document.activeElement).toBe(leaf);

    pressKey(document.activeElement, 'End');
    expect(document.activeElement).toBe(treeNode(container!, 'item:services:proxy'));
    pressKey(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'group:preferences'));

    reactAct(() => {
      treeNode(container!, 'item:preferences:theme').click();
    });
    expect(onThemeClick).toHaveBeenCalledTimes(2);

    const services = treeNode(container!, 'group:services');
    reactAct(() => {
      services.click();
    });
    expect(onSelectGroup).toHaveBeenCalledWith('services');
  });

  it('falls back to the event node when the stored focus id is no longer visible', () => {
    const onLanguageClick = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups(onLanguageClick)}
          activeGroupKey="preferences"
          activeItemKey="language"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const language = treeNode(container!, 'item:preferences:language');
    reactAct(() => {
      language.focus();
    });

    reactAct(() => {
      const caret = container!.querySelector('[data-settings-tree-toggle="group:preferences"]');
      expect(caret).toBeInstanceOf(HTMLElement);
      (caret as HTMLElement).click();
    });
    expect(container!.querySelector('[data-settings-tree-node="item:preferences:language"]')).toBeNull();

    const group = treeNode(container!, 'group:preferences');
    pressKey(group, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'group:services'));
  });

  it('keeps mouse and programmatic navigation on the selected settings page', () => {
    const onConnectedClick = vi.fn();
    const groups = [{
      key: 'services',
      title: '服务配置',
      description: '服务',
      items: [{
        key: 'ai',
        title: 'AI 设置',
        description: 'AI',
        onClick: vi.fn(),
        children: [{
          key: 'ai-providers',
          title: '模型供应商',
          description: '供应商',
          onClick: vi.fn(),
          children: [{
            key: 'ai-providers-connected',
            title: '已接入',
            description: '已保存配置',
            onClick: onConnectedClick,
          }],
        }],
      }],
    }];
    localStorage.removeItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY);

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="services"
          activeItemKey="ai-providers-connected"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    const connected = treeNode(container!, 'item:services:ai-providers-connected');
    expect(connected.getAttribute('aria-selected')).toBe('true');
    reactAct(() => {
      connected.click();
    });
    expect(onConnectedClick).toHaveBeenCalledTimes(1);

    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={groups}
          activeGroupKey="services"
          activeItemKey="ai-providers"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });
    expect(treeNode(container!, 'item:services:ai-providers').getAttribute('aria-selected')).toBe('true');
  });

  it('ignores movement keys when the tree has no visible nodes', () => {
    const onSelectGroup = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={[]}
          activeGroupKey="preferences"
          activeItemKey={null}
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={onSelectGroup}
        />,
      );
    });

    const tree = container!.querySelector('[role="tree"]');
    expect(tree).toBeInstanceOf(HTMLElement);
    reactAct(() => {
      (tree as HTMLElement).focus();
    });
    expect(document.activeElement).toBe(tree);

    pressKey(tree, 'ArrowDown');
    pressKey(tree, 'ArrowUp');
    pressKey(tree, 'Home');
    pressKey(tree, 'End');
    pressKey(tree, 'Enter');
    pressKey(tree, 'ArrowLeft');
    pressKey(tree, 'ArrowRight');
    expect(document.activeElement).toBe(tree);
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  const typeSearch = (value: string) => {
    const input = container!.querySelector<HTMLInputElement>('input[data-settings-tree-search="true"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    reactAct(() => {
      setter?.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input!;
  };

  it('filters the tree from the search box, expands hits and restores the browse state on clear', () => {
    localStorage.setItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY, JSON.stringify([]));
    const onProxyClick = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups(vi.fn(), onProxyClick)}
          activeGroupKey="preferences"
          activeItemKey="language"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={vi.fn()}
        />,
      );
    });

    // Only the active group is revealed; "services" stays collapsed.
    expect(container!.querySelectorAll('[role="treeitem"]')).toHaveLength(4);
    expect(treeNode(container!, 'group:services').getAttribute('aria-expanded')).toBe('false');

    typeSearch('代理');
    const visible = Array.from(container!.querySelectorAll('[data-settings-tree-node]'))
      .map((node) => node.getAttribute('data-settings-tree-node'));
    expect(visible).toEqual(['group:services', 'item:services:proxy']);
    expect(treeNode(container!, 'group:services').getAttribute('aria-expanded')).toBe('true');
    expect(container!.querySelector('.gonavi-settings-center-tree-highlight')?.textContent).toBe('代理');
    expect(container!.querySelector('.gonavi-settings-center-tree-search-empty')).toBeNull();
    // Search-time expansion is visual only: only the active group was persisted as expanded.
    expect(JSON.parse(localStorage.getItem(SETTINGS_CENTER_EXPANDED_KEYS_STORAGE_KEY) ?? '[]')).toEqual(['group:preferences']);

    typeSearch('不存在的设置');
    expect(container!.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(container!.querySelector('.gonavi-settings-center-tree-search-empty')?.textContent)
      .toBe(t('app.settings.search.empty'));

    typeSearch('');
    expect(container!.querySelectorAll('[role="treeitem"]')).toHaveLength(4);
    expect(treeNode(container!, 'group:services').getAttribute('aria-expanded')).toBe('false');
    expect(container!.querySelector('.gonavi-settings-center-tree-highlight')).toBeNull();
  });

  it('opens the first hit with Enter and moves focus into the tree with ArrowDown', () => {
    const onProxyClick = vi.fn();
    const onSelectGroup = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={createGroups(vi.fn(), onProxyClick)}
          activeGroupKey="preferences"
          activeItemKey="language"
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={onSelectGroup}
        />,
      );
    });

    const input = typeSearch('网络代理');
    pressKey(input, 'ArrowDown');
    expect(document.activeElement).toBe(treeNode(container!, 'group:services'));

    reactAct(() => {
      input.focus();
    });
    pressKey(input, 'Enter');
    expect(onSelectGroup).toHaveBeenCalledWith('services');

    pressKey(input, 'Escape');
    expect(input.value).toBe('');
    expect(container!.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1);
  });

  it('keeps keyboard focus on a leaf group', () => {
    const onSelectGroup = vi.fn();
    reactAct(() => {
      root?.render(
        <SettingsCenterTreeNav
          groups={[{
            key: 'about',
            title: '关于 GoNavi',
            description: '版本与更新',
            items: [],
          }]}
          activeGroupKey="about"
          activeItemKey={null}
          darkMode={false}
          overlayTheme={overlayTheme}
          ariaLabel="设置中心"
          onSelectGroup={onSelectGroup}
        />,
      );
    });

    const about = treeNode(container!, 'group:about');
    reactAct(() => {
      about.focus();
    });
    pressKey(about, 'ArrowDown');
    expect(document.activeElement).toBe(about);
    pressKey(about, 'ArrowRight');
    pressKey(about, 'ArrowLeft');
    pressKey(about, 'Enter');
    expect(document.activeElement).toBe(about);
    expect(onSelectGroup).not.toHaveBeenCalled();
  });
});
