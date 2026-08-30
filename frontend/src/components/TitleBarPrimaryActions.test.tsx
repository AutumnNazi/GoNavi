import React from 'react';
import { readFileSync } from 'node:fs';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import TitleBarPrimaryActions, {
  resolveTitleBarPrimaryActionShortcut,
} from './TitleBarPrimaryActions';
import {
  cloneShortcutOptions,
  DEFAULT_SHORTCUT_OPTIONS,
} from '../utils/shortcuts';

const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const v2ThemeCss = readFileSync(new URL('../v2-theme.css', import.meta.url), 'utf8');

vi.mock('@ant-design/icons', () => {
  const Icon = () => <span data-icon="true" />;
  return {
    ConsoleSqlOutlined: Icon,
    PlusOutlined: Icon,
  };
});

describe('TitleBarPrimaryActions', () => {
  it('matches the elevated primary titlebar action treatment', () => {
    const match = appCss.match(/\.gonavi-titlebar-primary-action\s*\{(?<body>[^}]*)\}/s);
    expect(match?.groups?.body).toContain('border-radius: 7px;');
    expect(match?.groups?.body).toContain('font-weight: 600;');
    expect(match?.groups?.body).toContain('-webkit-app-region: no-drag;');
    expect(match?.groups?.body).toMatch(/background:\s*color-mix/);
  });

  it('keeps the custom window controls borderless under the v2 button theme', () => {
    const match = appCss.match(
      /\.titlebar-window-controls > \.ant-btn\.ant-btn-text\s*\{(?<body>[^}]*)\}/s,
    );
    expect(match, 'Missing titlebar window-control override').not.toBeNull();
    const body = match?.groups?.body ?? '';
    expect(body).toContain('border: 0 !important;');
    expect(body).toContain('border-radius: 0 !important;');
    expect(body).toContain('box-shadow: none !important;');

    const closeHoverMatch = appCss.match(
      /\.titlebar-window-controls > \.titlebar-close-btn\.ant-btn-text:hover\s*\{(?<body>[^}]*)\}/s,
    );
    expect(closeHoverMatch, 'Missing close-button hover override').not.toBeNull();
    expect(closeHoverMatch?.groups?.body).toContain('background-color: #ff4d4f !important;');
    expect(closeHoverMatch?.groups?.body).toContain('color: #fff !important;');
  });

  it('keeps the V2 titlebar context marker styles available', () => {
    expect(v2ThemeCss).toContain('.gn-v2-titlebar-status.is-success .gn-v2-titlebar-status-dot');
    expect(v2ThemeCss).toContain('max-width: min(520px, calc(100vw - 620px));');
    expect(v2ThemeCss).toContain('calc(100vw - 620px)');
    expect(v2ThemeCss).not.toContain('calc(100vw - 1120px)');
    expect(v2ThemeCss).toContain('@media (min-width: 921px) and (max-width: 1230px)');
    expect(v2ThemeCss).toContain('@media (max-width: 920px)');
  });

  it('keeps a selected-but-unconnected titlebar marker neutral', () => {
    const statusRule = v2ThemeCss.match(
      /body\[data-ui-version="v2"\] \.gn-v2-titlebar-status\s*\{(?<body>[^}]*)\}/s,
    );
    expect(statusRule, 'Missing titlebar marker base rule').not.toBeNull();
    expect(statusRule?.groups?.body).toContain('width: 14px;');
    expect(statusRule?.groups?.body).toContain('height: 14px;');
    expect(statusRule?.groups?.body).toContain('flex: 0 0 14px;');
    expect(statusRule?.groups?.body).toContain('overflow: visible;');
    expect(statusRule?.groups?.body).toContain('color: var(--gn-fg-4);');

    expect(v2ThemeCss).not.toContain('.gn-v2-titlebar-center[data-connection-status="selected"] .gn-v2-titlebar-status');
    expect(v2ThemeCss).toContain('color: var(--gn-fg-4);');
  });

  it('keeps the V2 titlebar marker unclipped', () => {
    const centerRule = v2ThemeCss.match(
      /body\[data-ui-version="v2"\] \.gn-v2-titlebar-center\s*\{(?<body>[^}]*)\}/s,
    );
    expect(centerRule?.groups?.body).toContain('overflow: visible;');
    expect(centerRule?.groups?.body).toContain('z-index: 1;');
    const dotRule = v2ThemeCss.match(
      /body\[data-ui-version="v2"\] \.gn-v2-titlebar-status-dot\s*\{(?<body>[^}]*)\}/s,
    );
    expect(dotRule, 'Missing titlebar dot geometry rule').not.toBeNull();
    expect(dotRule?.groups?.body).toContain('width: 9px;');
    expect(dotRule?.groups?.body).toContain('height: 9px;');
    expect(dotRule?.groups?.body).toContain('flex: 0 0 9px;');
    expect(dotRule?.groups?.body).toContain('box-sizing: border-box;');
    expect(dotRule?.groups?.body).toContain('border-radius: 50%;');
    const loadingDotRule = v2ThemeCss.match(
      /body\[data-ui-version="v2"\] \.gn-v2-titlebar-status\.is-loading \.gn-v2-titlebar-status-dot\s*\{(?<body>[^}]*)\}/s,
    );
    expect(loadingDotRule, 'Missing titlebar loading dot rule').not.toBeNull();
    expect(loadingDotRule?.groups?.body).toContain('width: 10px;');
    expect(loadingDotRule?.groups?.body).toContain('height: 10px;');
    expect(loadingDotRule?.groups?.body).toContain('flex-basis: 10px;');
    expect(loadingDotRule?.groups?.body).toContain('border-top-color: #2563eb;');
    const copyRule = v2ThemeCss.match(
      /body\[data-ui-version="v2"\] \.gn-v2-titlebar-copy\s*\{(?<body>[^}]*)\}/s,
    );
    expect(copyRule?.groups?.body).toContain('overflow: hidden;');
    expect(v2ThemeCss).not.toContain('.gn-v2-titlebar-center span:last-child');
    expect(v2ThemeCss).toContain('.gn-v2-tree-status.is-loading::before');
    expect(v2ThemeCss).toContain('.gn-v2-tree-status.is-success::before');
    expect(v2ThemeCss).toContain('.gn-v2-tree-status.is-error::before');
    expect(v2ThemeCss).toContain('.gn-v2-titlebar-status-dot');
    expect(v2ThemeCss).toContain('.gn-v2-titlebar-status.is-loading .gn-v2-titlebar-status-dot');
    expect(v2ThemeCss).toContain('.gn-v2-titlebar-status.is-success .gn-v2-titlebar-status-dot');
    expect(v2ThemeCss).toContain('.gn-v2-titlebar-status.is-error .gn-v2-titlebar-status-dot');
    expect(v2ThemeCss).toContain('@keyframes gn-v2-titlebar-status-spin');
    expect(v2ThemeCss).not.toContain('.gn-v2-titlebar-live');
    expect(v2ThemeCss).toContain('flex: 0 0 14px;');
    expect(v2ThemeCss).toContain('box-sizing: border-box;');
    expect(v2ThemeCss).toContain('animation: gn-v2-titlebar-status-spin 0.8s linear infinite;');
    expect(v2ThemeCss).toContain('border-top-color: #2563eb;');
  });

  it('shows both labels in query-first order and invokes their actions', () => {
    const onNewQuery = vi.fn();
    const onNewConnection = vi.fn();
    const shortcutOptions = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    const renderer = create(
      <TitleBarPrimaryActions
        newQueryLabel="新建查询"
        newConnectionLabel="新建连接"
        newQueryShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newQueryTab', 'mac')}
        newConnectionShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newConnection', 'mac')}
        onNewQuery={onNewQuery}
        onNewConnection={onNewConnection}
      />,
    );

    const actions = renderer.root.findByProps({ 'data-titlebar-primary-actions': 'true' });
    const buttons = actions.findAllByType('button');
    expect(actions.props['data-no-titlebar-toggle']).toBe('true');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual(['新建查询', '新建连接']);
    expect(buttons.map((button) => button.props.title)).toEqual([
      '新建查询 · ⌘N',
      '新建连接 · ⌘⇧N',
    ]);
    expect(buttons.map((button) => button.children[button.children.length - 1])).toEqual(['新建查询', '新建连接']);

    buttons[0].props.onClick();
    buttons[1].props.onClick();
    expect(onNewQuery).toHaveBeenCalledTimes(1);
    expect(onNewConnection).toHaveBeenCalledTimes(1);
  });

  it('shows both Windows shortcut labels', () => {
    const shortcutOptions = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    const renderer = create(
      <TitleBarPrimaryActions
        newQueryLabel="New Query"
        newConnectionLabel="New Connection"
        newQueryShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newQueryTab', 'windows')}
        newConnectionShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newConnection', 'windows')}
        onNewQuery={vi.fn()}
        onNewConnection={vi.fn()}
      />,
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props.title)).toEqual([
      'New Query · Ctrl+N',
      'New Connection · Ctrl+Shift+N',
    ]);
  });

  it('accepts a message-oriented icon for the context-aware primary action', () => {
    const renderer = create(
      <TitleBarPrimaryActions
        newQueryLabel="消息工作台"
        newQueryIcon={<span data-icon="message-workbench" />}
        newConnectionLabel="新建连接"
        onNewQuery={vi.fn()}
        onNewConnection={vi.fn()}
      />,
    );

    const primaryButton = renderer.root.findAllByType('button')[0];
    expect(primaryButton.findByProps({ 'data-icon': 'message-workbench' })).toBeTruthy();
    expect(primaryButton.props['aria-label']).toBe('消息工作台');
  });

  it('uses current platform custom bindings and hides disabled shortcuts', () => {
    const shortcutOptions = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    shortcutOptions.newQueryTab.mac = { combo: 'Meta+Alt+Q', enabled: true };
    shortcutOptions.newQueryTab.windows = { combo: 'Ctrl+Alt+W', enabled: true };
    shortcutOptions.newConnection.mac = { combo: 'Meta+Shift+C', enabled: false };
    shortcutOptions.newConnection.windows = { combo: 'Ctrl+Alt+C', enabled: true };

    expect(resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newQueryTab', 'mac')).toBe('⌘⌥Q');
    expect(resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newQueryTab', 'windows')).toBe('Ctrl+Alt+W');
    expect(resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newConnection', 'mac')).toBeUndefined();
    expect(resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newConnection', 'windows')).toBe('Ctrl+Alt+C');

    const renderer = create(
      <TitleBarPrimaryActions
        newQueryLabel="新建查询"
        newConnectionLabel="新建连接"
        newQueryShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newQueryTab', 'mac')}
        newConnectionShortcut={resolveTitleBarPrimaryActionShortcut(shortcutOptions, 'newConnection', 'mac')}
        onNewQuery={vi.fn()}
        onNewConnection={vi.fn()}
      />,
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props.title)).toEqual([
      '新建查询 · ⌘⌥Q',
      '新建连接',
    ]);
    expect(buttons.map((button) => button.props['aria-label'])).toEqual(['新建查询', '新建连接']);
    expect(buttons.every((button) => button.props.disabled !== true)).toBe(true);
  });
});
