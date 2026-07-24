import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TAB_WORKBENCH_CLASS_NAME,
  handleTabDragPointerDown,
  resolveTabHoverOpen,
  resolveTabHoverTitle,
  shouldShowV2ConnectionLabel,
  TabHoverInfo,
  isMiddleMouseButton,
  shouldActivateTabDragPointer,
  stopTabHoverDragPropagation,
} from './TabManager';
import { setCurrentLanguage } from '../i18n';
import { catalogs } from '../i18n/catalog';
import type { TabData } from '../types';
import { buildTabDisplayModel } from '../utils/tabDisplay';

const TAB_MANAGER_SQL_FILE_CLOSE_KEYS = [
  'tab_manager.sql_file_close.read_failed_cancel_close',
  'tab_manager.sql_file_close.dirty_single_label',
  'tab_manager.sql_file_close.dirty_multiple_label',
  'tab_manager.sql_file_close.save_confirm_title',
  'tab_manager.sql_file_close.save_confirm_content',
  'tab_manager.sql_file_close.save_and_close',
  'tab_manager.sql_file_close.discard',
  'tab_manager.sql_file_close.save_failed',
  'tab_manager.sql_file_close.unknown_error',
  'tab_manager.sql_file_close.saved',
  'tab_manager.sql_file_close.missing_single_label',
  'tab_manager.sql_file_close.missing_multiple_label',
  'tab_manager.sql_file_close.missing_confirm_title',
  'tab_manager.sql_file_close.missing_confirm_content',
  'tab_manager.sql_file_close.continue_close',
  'tab_manager.sql_file_close.close_tabs',
] as const;

const TAB_MANAGER_MENU_KEYS = [
  'tab_manager.menu.tab_display_settings',
  'tab_manager.menu.close_other',
  'tab_manager.menu.close_left',
  'tab_manager.menu.close_right',
  'tab_manager.menu.close_all',
] as const;

const stripSourceComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  setCurrentLanguage('zh-CN');
});

describe('TabManager hover info', () => {
  it('starts tab dragging only from a primary pointer on non-interactive tab content', () => {
    const tabContent = {
      closest: vi.fn(() => null),
    } as unknown as EventTarget;
    const closeIcon = {
      closest: vi.fn((selector: string) =>
        selector.includes('.gn-v2-tab-close') ? { className: 'gn-v2-tab-close' } : null),
    } as unknown as EventTarget;
    const legacyCloseIcon = {
      closest: vi.fn((selector: string) =>
        selector.includes('.ant-tabs-tab-remove') ? { className: 'ant-tabs-tab-remove' } : null),
    } as unknown as EventTarget;
    const contextMenuItem = {
      closest: vi.fn((selector: string) =>
        selector.includes('[role="menuitem"]') ? { role: 'menuitem' } : null),
    } as unknown as EventTarget;

    expect(shouldActivateTabDragPointer({ button: 0, target: tabContent })).toBe(true);
    expect(shouldActivateTabDragPointer({ button: 0, target: closeIcon })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 0, target: legacyCloseIcon })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 0, target: contextMenuItem })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 1, target: tabContent })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 2, target: tabContent })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 0, ctrlKey: true, target: tabContent })).toBe(false);
    expect(shouldActivateTabDragPointer({ button: 0, isPrimary: false, target: tabContent })).toBe(false);
  });

  it('does not capture or notify dnd-kit for close and context-menu pointers', () => {
    const setPointerCapture = vi.fn();
    const listener = vi.fn();
    const tabContent = { closest: vi.fn(() => null) } as unknown as EventTarget;
    const closeIcon = {
      closest: vi.fn(() => ({ className: 'gn-v2-tab-close' })),
    } as unknown as EventTarget;
    const contextMenuItem = {
      closest: vi.fn((selector: string) =>
        selector.includes('[role="menuitem"]') ? { role: 'menuitem' } : null),
    } as unknown as EventTarget;
    const buildEvent = (overrides: Record<string, unknown> = {}) => ({
      button: 0,
      ctrlKey: false,
      isPrimary: true,
      pointerId: 7,
      target: tabContent,
      currentTarget: { setPointerCapture },
      ...overrides,
    }) as unknown as React.PointerEvent<HTMLElement>;

    handleTabDragPointerDown(buildEvent(), listener);
    expect(setPointerCapture).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();

    setPointerCapture.mockClear();
    listener.mockClear();
    handleTabDragPointerDown(buildEvent({ target: closeIcon }), listener);
    handleTabDragPointerDown(buildEvent({ target: contextMenuItem }), listener);
    handleTabDragPointerDown(buildEvent({ button: 2 }), listener);
    handleTabDragPointerDown(buildEvent({ ctrlKey: true }), listener);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('recognizes only the auxiliary middle mouse button for tab closing', () => {
    expect(isMiddleMouseButton(1)).toBe(true);
    expect(isMiddleMouseButton(0)).toBe(false);
    expect(isMiddleMouseButton(2)).toBe(false);
  });

  it('memoizes the tab workbench so parent-only modal state does not repaint open tabs', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const TabManager: React.FC = React.memo(() => {');
  });

  it('routes the workspace close command through the docked active tab close coordinator', () => {
    const source = stripSourceComments(readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8'));
    const handlerStart = source.indexOf('const requestCloseActiveWorkspaceTab = useCallback(() => {');
    const handlerEnd = source.indexOf('\n  useEffect(() => {', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(source).toContain("import { CLOSE_ACTIVE_WORKSPACE_TAB_EVENT, resolveDockedActiveTabId } from '../utils/closeTabShortcut';");
    expect(handlerSource).toContain('if (!dockedActiveTabId) return;');
    expect(handlerSource).toContain('closeTabsWithSQLFilePrompt(\n      [dockedActiveTabId],\n      () => closeTab(dockedActiveTabId),');
    expect(handlerSource).not.toContain('[activeTabId]');
    expect(source).toContain('window.addEventListener(CLOSE_ACTIVE_WORKSPACE_TAB_EVENT, requestCloseActiveWorkspaceTab);');
    expect(source).toContain('window.removeEventListener(CLOSE_ACTIVE_WORKSPACE_TAB_EVENT, requestCloseActiveWorkspaceTab);');
    expect(source).not.toContain("window.addEventListener('keydown'");
  });

  it('keeps the tab workbench as a full-height flex child in legacy and v2 UI', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(TAB_WORKBENCH_CLASS_NAME).toBe('tab-workbench');
    expect(source).toContain("className={`${TAB_WORKBENCH_CLASS_NAME}${isV2Ui ? ' gn-v2-tab-workbench' : ''}`}");
    expect(source).toContain('.${TAB_WORKBENCH_CLASS_NAME} {');
    expect(source).toMatch(/\.\$\{TAB_WORKBENCH_CLASS_NAME\} \{[\s\S]*height: 100%;[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*overflow: hidden;/);
  });

  it('renders en-US v2 tab hover context for table tabs while keeping raw values raw', () => {
    setCurrentLanguage('en-US');
    const tab: TabData = {
      id: 'conn-1-main-users',
      title: 'users',
      type: 'table',
      connectionId: 'conn-1',
      tableName: '客户表',
    };

    const markup = renderToStaticMarkup(
      <TabHoverInfo
        tab={tab}
        displayTitle="[开发240] 表概览"
      />,
    );

    expect(markup).toContain('data-tab-hover-info="true"');
    expect(markup).toContain('[开发240] 表概览');
    expect(markup).toContain('Type');
    expect(markup).toContain('Table data');
    expect(markup).toContain('Connection');
    expect(markup).toContain('Unbound connection');
    expect(markup).toContain('Host');
    expect(markup).toContain('Not configured');
    expect(markup).toContain('Database');
    expect(markup).toContain('Not specified');
    expect(markup).toContain('Object');
    expect(markup).toContain('客户表');
    expect(markup).not.toContain('类型');
    expect(markup).not.toContain('表数据');
    expect(markup).not.toContain('未绑定连接');
    expect(markup).not.toContain('未配置');
    expect(markup).not.toContain('数据库');
    expect(markup).not.toContain('未指定');
    expect(markup).not.toContain('对象');
  });

  it('renders db identity for redis tabs without a database name', () => {
    setCurrentLanguage('en-US');
    const tab: TabData = {
      id: 'redis-keys-conn-1-db2',
      title: 'db2',
      type: 'redis-keys',
      connectionId: 'conn-1',
      redisDB: 2,
    };

    const markup = renderToStaticMarkup(
      <TabHoverInfo
        tab={tab}
        displayTitle="[缓存 | 10.0.0.8] db2"
        connectionLabel="缓存"
        hostSummary="10.0.0.8"
      />,
    );

    expect(markup).toContain('<span>Redis</span><strong>[缓存 | 10.0.0.8] db2</strong>');
    expect(markup).not.toContain('<span>REDIS</span>');
    expect(markup).toContain('Redis Key');
    expect(markup).toContain('Not specified');
    expect(markup).toContain('db2');
  });

  it('keeps compact v2 tab kind badges catalog-backed instead of raw source abbreviations', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');
    const getTabKindLabelSource = source.slice(
      source.indexOf('const getTabKindLabel = (tab: TabData): string => {'),
      source.indexOf('export const TAB_WORKBENCH_CLASS_NAME'),
    );

    [
      'query',
      'table',
      'design',
      'table_overview',
      'redis',
      'jvm',
      'trigger',
      'materialized_view',
      'view',
      'event',
      'routine',
      'sql_analysis',
      'fallback',
    ].forEach((name) => {
      expect(getTabKindLabelSource).toContain(`t('tab_manager.kind_badge.${name}')`);
    });
    expect(getTabKindLabelSource).not.toMatch(/return '(TABLE|DESIGN|DB|REDIS|JVM|TRG|MV|VIEW|EVT|FUNC|TAB)'/);
  });

  it('keeps v2 hover title focused on the tab object instead of appending secondary display fields', () => {
    const tab: TabData = {
      id: 'overview-1',
      title: '表概览 - front_end_sys',
      type: 'table-overview',
      connectionId: 'conn-1',
      dbName: 'front_end_sys',
    };
    const displayModel = buildTabDisplayModel(tab, {
      id: 'conn-1',
      name: '开发240',
      config: {
        type: 'mysql',
        host: '192.168.1.240',
        port: 3306,
        user: 'root',
        database: 'front_end_sys',
      },
    }, {
      layout: 'double',
      primaryElements: ['object', 'kind'],
      secondaryElements: ['connection', 'database'],
    });

    expect(displayModel.fullTitle).toContain('[开发240]');
    expect(resolveTabHoverTitle(displayModel, displayModel.fullTitle)).toBe('表概览 - front_end_sys');
  });

  it('stops hover card pointer events from reaching tab drag listeners without blocking text selection', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.SyntheticEvent<HTMLElement>;

    stopTabHoverDragPropagation(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('keeps tab hover hidden while the tab context menu is open', () => {
    expect(resolveTabHoverOpen(true, false)).toBe(true);
    expect(resolveTabHoverOpen(true, true)).toBe(false);
    expect(resolveTabHoverOpen(false, true)).toBe(false);
  });

  it('opens tab display settings from the v2 tab context menu', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain("new CustomEvent('gonavi:open-tab-display-settings')");
    expect(source).toContain("if (typeof window === 'undefined')");
  });

  it('hides the v2 gray connection suffix when the title already carries the same prefix', () => {
    expect(shouldShowV2ConnectionLabel('[本地] videos', '本地')).toBe(false);
    expect(shouldShowV2ConnectionLabel('[缓存 | 10.0.0.8] db2', '缓存')).toBe(false);
    expect(shouldShowV2ConnectionLabel('新建查询', '本地')).toBe(true);
  });

  it('does not render the v2 leading icon or connection accent dot in tab labels', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('gn-v2-tab-kind-icon');
    expect(source).not.toContain('tab-connection-accent');
    expect(source).not.toContain('has-connection-accent');
    expect(source).not.toContain('resolveConnectionAccentColor');
  });

  it('keeps v2 TabManager shell copy in the i18n catalog instead of hardcoded Chinese', () => {
    const source = stripSourceComments(readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8'));

    [
      '类型',
      '表数据',
      '连接',
      '未绑定连接',
      '未配置',
      '数据库',
      '未指定',
      '对象',
      'SQL 查询',
      '表设计',
      '表概览',
      'Redis 命令',
      'Redis 监控',
      'JVM 概览',
      'JVM 资源',
      'JVM 审计',
      'JVM 诊断',
      'JVM 监控',
      '触发器',
      '物化视图',
      '视图',
      '事件',
      '函数 / 过程',
      '标签页',
      '关闭其他页',
      '关闭左侧',
      '关闭右侧',
      '关闭所有',
      '关闭 ',
      'GoNavi 起始工作台',
      '快捷工作流',
      '连接、查询和分析从同一个工作台开始。',
      '选择数据源、打开查询编辑器，或把上下文交给 AI 面板继续处理。',
      '打开 AI',
      '配置数据源',
      'URI、SSH、代理和驱动集中设置',
      '启动 SQL 工作区',
      '按当前上下文打开查询编辑器',
      '进入 AI 辅助',
      '解释 SQL、生成查询、梳理结果',
    ].forEach((text) => {
      expect(source).not.toContain(text);
    });
  });

  it('subscribes TabManager and memoized localized tab items to languagePreference', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/const languagePreference = useStore\(\(?state\)? => state\.languagePreference\);/);
    expect(source).toMatch(/const items = useMemo\([\s\S]*\), \[[^\]]*languagePreference[^\]]*\]\);/);
  });

  it('renders tab labels from appearance tab display settings', () => {
    const source = stripSourceComments(readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8'));

    expect(source).toContain('buildTabDisplayModel(tab, connection, appearance.tabDisplay, t)');
    expect(source).toContain('displayModel={displayModel}');
    expect(source).toContain('displayModel.primaryParts.map(renderV2TabDisplayPart)');
    expect(source).toContain('renderV2TabSecondaryParts(displayModel.secondaryParts)');
    expect(source).toContain('aria-label={displayModel.secondaryText}');
    expect(source).toContain('className="gn-v2-tab-label-separator" aria-hidden="true">·</span>');
    expect(source).toContain("if (part.key === 'kind')");
    expect(source).toContain('className="gn-v2-tab-kind"');
    expect(source).toContain('hasDoubleLineTabLabel');
    expect(source).toContain('gn-v2-main-tabs-double');
    expect(source).toContain('showSecondaryLine');
    expect(source).toContain('gn-v2-tab-label-secondary');
    expect(source).toContain('gn-v2-tab-label-rich');
    expect(source).toContain('gn-v2-tab-label-double');
    expect(source).toContain('gn-v2-tab-label-main tab-title-text');
    expect(source).toContain("key: 'tab-display-settings'");
    expect(source).toContain("label: t('tab_manager.menu.tab_display_settings')");
    expect(source).not.toContain("label: '标签设置'");
    expect(source).toContain('icon: <SettingOutlined />');
    expect(source).toContain('onClick: openTabDisplaySettings');
    expect(source).toContain("rootClassName={isV2Ui ? 'gn-v2-tab-context-menu-popup' : undefined}");
    expect(source).not.toContain('gn-v2-main-tabs-rich');
  });

  it('keeps short secondary connection labels content-sized', () => {
    const css = readFileSync(new URL('../v2-theme.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.gn-v2-tab-label-part-connection \{[^}]*flex: 0 1 auto;[^}]*max-width: 92px;/s);
    expect(css).not.toMatch(/\.gn-v2-tab-label-part-connection \{[^}]*flex: 0 1 92px;/s);
  });

  it('wires hover card tab-switch and drag-blocking handlers with selectable text styles', () => {
    const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onMouseDown={handleTabLabelMouseDown}');
    expect(source).toContain('onAuxClick={handleTabLabelAuxClick}');
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain('onClose();');
    expect(source).toContain('onPointerDown={stopTabHoverDragPropagation}');
    expect(source).toContain('onPointerUp={stopTabHoverDragPropagation}');
    expect(source).toContain('onPointerDownCapture={stopTabHoverDragPropagation}');
    expect(source).toContain('onMouseDown={stopTabHoverDragPropagation}');
    expect(source).toContain('onMouseUp={stopTabHoverDragPropagation}');
    expect(source).toContain('onClick={stopTabHoverDragPropagation}');
    expect(source).toContain('onClickCapture={stopTabHoverDragPropagation}');
    expect(source).toContain('onTouchStart={stopTabHoverDragPropagation}');
    expect(source).toContain('onTouchEnd={stopTabHoverDragPropagation}');
    expect(source).toContain('setIsHoverInfoOpen(false);');
    expect(source).toContain('setIsTabMenuOpen(true);');
    expect(source).toContain('open={resolveTabHoverOpen(isHoverInfoOpen, isTabMenuOpen)}');
    expect(source).toContain('onOpenChange={handleHoverInfoOpenChange}');
    expect(source).toContain('onOpenChange={handleTabMenuOpenChange}');
    expect(source).toContain('mouseEnterDelay={1.2}');
    expect(source).toMatch(/\.gn-v2-tab-hover-card \{[^}]*cursor: text;[^}]*user-select: text;/s);
    expect(source).toContain("--gn-v2-tab-hover-grid-columns: 56px minmax(0, 1fr);");
    expect(source).toMatch(/\.gn-v2-tab-hover-head \{[^}]*display: grid;[^}]*grid-template-columns: var\(--gn-v2-tab-hover-grid-columns\);/s);
    expect(source).toMatch(/\.gn-v2-tab-hover-head > strong \{[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/s);
    expect(source).toMatch(/\.gn-v2-tab-hover-row \{[^}]*grid-template-columns: var\(--gn-v2-tab-hover-grid-columns\);/s);
    expect(source).toMatch(/\.gn-v2-tab-hover-card \* \{[^}]*user-select: text;/s);
  });

  it('guards closing opened SQL file tabs with save confirmation', () => {
    const source = stripSourceComments(readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8'));

    expect(source).toContain('ReadSQLFile(filePath)');
    expect(source).toContain('isSQLFileMissingReadResult(res)');
    expect(source).toContain('isSQLFileMissingErrorMessage(errorMessage)');
    TAB_MANAGER_SQL_FILE_CLOSE_KEYS.forEach((key) => {
      expect(source).toContain(`t('${key}'`);
    });
    [
      '读取 SQL 文件失败，已取消关闭',
      '保存 SQL 文件修改？',
      '有未保存修改，是否保存后再关闭？',
      '保存并关闭',
      '不保存',
      '未知错误',
      'SQL 文件已保存',
      '关闭已丢失的 SQL 文件标签？',
      '对应的外部 SQL 文件已不存在或已被移动',
      '继续关闭',
      '关闭标签',
    ].forEach((text) => {
      expect(source).not.toContain(text);
    });
    expect(source).toContain('confirmDirtyTabsOrClose();');
    expect(source).toContain("getSQLFileTabDraft(tab.id, String(tab.query ?? ''))");
    expect(source).toContain('hasSQLFileTabUnsavedChanges({ ...tab, query: draft }, normalizeSQLFileReadContent(res.data))');
    expect(source).toContain('WriteSQLFile(filePath, draft)');
    expect(source).toContain('clearSQLFileTabDraft(tab.id)');
    expect(source).toContain('closeTabsWithSQLFilePrompt([id], () => closeTab(id))');
    expect(source).toContain('closeTabsWithSQLFilePrompt(getCloseOtherTabIds(tabs, tab.id), () => closeOtherTabs(tab.id))');
    expect(source).toContain('closeTabsWithSQLFilePrompt(getCloseTabsToLeftIds(dockedTabs, tab.id), () => closeTabsToLeft(tab.id))');
    expect(source).toContain('closeTabsWithSQLFilePrompt(getCloseTabsToRightIds(dockedTabs, tab.id), () => closeTabsToRight(tab.id))');
    expect(source).toContain('closeTabsWithSQLFilePrompt(tabs.map((item) => item.id), () => closeAllTabs())');
  });

  it('keeps SQL file close prompt keys in every catalog', () => {
    Object.entries(catalogs).forEach(([language, catalog]) => {
      TAB_MANAGER_SQL_FILE_CLOSE_KEYS.forEach((key) => {
        expect(catalog, `${language}:${key}`).toHaveProperty(key);
      });
    });
  });

  it('keeps tab context menu keys in every catalog', () => {
    Object.entries(catalogs).forEach(([language, catalog]) => {
      TAB_MANAGER_MENU_KEYS.forEach((key) => {
        expect(catalog, `${language}:${key}`).toHaveProperty(key);
      });
    });
  });
});
