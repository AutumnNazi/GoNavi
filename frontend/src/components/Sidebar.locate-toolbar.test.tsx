import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readV2ThemeCss } from '../test/readV2ThemeCss';

import Sidebar, {
  buildAllSavedQueriesTreeNode,
  buildSidebarConnectionTagTree,
  buildSidebarTableChildrenForUi,
  buildV2SidebarTableSectionedChildren,
  buildSQLFileExecutionFooter,
  buildV2RailConnectionGroups,
  estimateV2TreeHorizontalScrollWidth,
  filterV2CommandSearchTreeItems,
  filterV2ExplorerTreeByKind,
  getV2RailConnectionGroupBadgeText,
  hasSidebarLazyChildren,
  isConnectionTagDescendant,
  normalizeSidebarTreeRelativeDropPosition,
  parseV2CommandSearchQuery,
  resolveV2CommandSearchPersistentFilter,
  type V2CommandSearchItem,
  resolveSidebarDropNodeFromDomEvent,
  resolveSidebarTagDropInsertBefore,
  resolveSidebarDropTargetMetricsFromDomEvent,
  resolveSidebarDropInsertBefore,
  resolveSidebarNodeConnectionId,
  resolveSidebarSwitcherLoadKey,
  resolveV2ActiveConnectionId,
  resolveV2ObjectGroupTitle,
  isSidebarTablePinned,
  SQLFileExecutionProgressContent,
  resolveSidebarTableNameForCopy,
  resolveSidebarDatabaseNameForCopy,
  shouldKeepSidebarSwitcherCollapsedWhileLoading,
  shouldClearSidebarActiveContextOnEmptySelect,
  shouldSkipSidebarLoadOnExpandWhileDragging,
  shouldSkipSidebarSelectWhileDragging,
  shouldLoadSidebarNodeOnExpand,
  shouldCloseV2CommandSearchOnGlobalKey,
  shouldRunV2CommandSearchEnter,
  sortSidebarTableEntries,
} from './Sidebar';
import {
  buildSearchScopeOptions as buildCoreSearchScopeOptions,
  SEARCH_SCOPE_OPTIONS as CORE_SEARCH_SCOPE_OPTIONS,
} from './sidebarCoreUtils';
import {
  buildSidebarTableChildrenForUi as buildV2UtilsSidebarTableChildrenForUi,
  buildV2ExplorerFilterOptions,
  buildV2SidebarTableSectionedChildren as buildV2UtilsSidebarTableSectionedChildren,
  V2_EXPLORER_FILTER_OPTIONS as V2_UTILS_EXPLORER_FILTER_OPTIONS,
} from './sidebarV2Utils';
import {
  buildSidebarRootConnectionToken,
  buildSidebarRootTagToken,
  buildSidebarTablePinKey,
} from '../store';
import { renderSidebarV2TreeTitle } from './sidebar/SidebarTreeTitle';
import { buildSidebarTableStatusSQL } from './sidebar/sidebarMetadataLoaders';
import {
  DEFAULT_SHORTCUT_OPTIONS,
  cloneShortcutOptions,
} from '../utils/shortcuts';
import { SUPPORTED_LANGUAGES, getCurrentLanguage, setCurrentLanguage, t } from '../i18n';
import { I18nProvider } from '../i18n/provider';
import {
  V2ConnectionGroupContextMenuView,
  V2ConnectionContextMenuView,
  V2DatabaseContextMenuView,
  V2SchemaContextMenuView,
  V2TableContextMenuView,
  V2TableGroupContextMenuView,
  formatV2TableContextMenuRows,
  formatV2TableContextMenuSize,
} from './V2TableContextMenu';

const readSourceFile = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readCssRuleBlock = (css: string, selector: string) => {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.groups?.body ?? '';
};
const readSidebarSource = () => [
  readSourceFile('./Sidebar.tsx'),
  readSourceFile('./sidebar/sidebarHelpers.ts'),
  readSourceFile('./sidebar/SidebarConnectionRail.tsx'),
  readSourceFile('./sidebar/SidebarSearchPanel.tsx'),
  readSourceFile('./sidebar/sidebarLegacyNodeMenu.tsx'),
  readSourceFile('./sidebar/sidebarMetadataLoaders.ts'),
  readSourceFile('./sidebar/useSidebarBatchExport.ts'),
  readSourceFile('./sidebar/SidebarExternalSqlWorkflow.tsx'),
  readSourceFile('./sidebar/useSidebarTreeLoaders.tsx'),
  readSourceFile('./sidebar/SidebarEntityModals.tsx'),
  readSourceFile('./sidebar/SidebarTreeTitle.tsx'),
  readSourceFile('./sidebar/useSidebarV2ContextMenu.tsx'),
  readSourceFile('./sidebar/useSidebarObjectActions.tsx'),
  readSourceFile('./sidebar/useSidebarSearchModel.tsx'),
  readSourceFile('./sidebar/useSidebarV2ActionHandlers.tsx'),
  readSourceFile('./sidebar/useSidebarCommandSearchRunner.ts'),
  readSourceFile('./sidebar/useSidebarTitleRender.tsx'),
  readSourceFile('./sidebarV2Utils.ts'),
].join('\n');
const readLegacyNodeMenuSource = () => readSourceFile('./sidebar/sidebarLegacyNodeMenu.tsx');

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
  state: {
    connections: [] as any[],
    activeContext: null as any,
    activeTabId: 'conn-1-main-users',
    tabs: [{
      id: 'conn-1-main-users',
      title: 'users',
      type: 'table',
      connectionId: 'conn-1',
      dbName: 'main',
      tableName: 'users',
    }] as any[],
    connectionTags: [] as any[],
    appearance: {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'legacy',
      sidebarHiddenObjectGroups: [],
    } as any,
    shortcutOptions: null as any,
  },
}));

vi.mock('../store', () => ({
  buildSidebarRootConnectionToken: (connectionId: string) => `connection:${connectionId.trim()}`,
  buildSidebarRootTagToken: (tagId: string) => `tag:${tagId.trim()}`,
  resolveConnectionTagChildOrder: (
    tagId: string,
    connectionTags: Array<{ id: string; parentTagId?: string; connectionIds: string[]; childOrder?: string[] }>,
  ) => {
    const tag = connectionTags.find((candidate) => candidate.id === tagId);
    if (!tag) return [];
    const fallback = [
      ...tag.connectionIds.map((connectionId) => `connection:${connectionId}`),
      ...connectionTags
        .filter((candidate) => candidate.parentTagId === tagId)
        .map((candidate) => `tag:${candidate.id}`),
    ];
    const valid = new Set(fallback);
    const seen = new Set<string>();
    return [...(tag.childOrder || []), ...fallback].filter((token) => {
      if (!valid.has(token) || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
  },
  resolveSidebarRootOrderTokens: (
    sidebarRootOrder: unknown,
    connectionTags: Array<{ id: string; parentTagId?: string; connectionIds: string[] }>,
    connections: Array<{ id: string }>,
  ) => {
    const groupedConnectionIds = new Set<string>();
    connectionTags.forEach((tag) => tag.connectionIds.forEach((id) => groupedConnectionIds.add(id)));
    const fallback = [
      ...connectionTags.filter((tag) => !tag.parentTagId).map((tag) => `tag:${tag.id}`),
      ...connections
        .filter((conn) => !groupedConnectionIds.has(conn.id))
        .map((conn) => `connection:${conn.id}`),
    ];
    const valid = new Set(fallback);
    const normalized = Array.isArray(sidebarRootOrder)
      ? sidebarRootOrder
        .map((item) => String(item ?? '').trim())
        .filter((item) => valid.has(item))
      : [];
    const seen = new Set<string>();
    const result: string[] = [];
    [...normalized, ...fallback].forEach((token) => {
      if (!token || seen.has(token)) return;
      seen.add(token);
      result.push(token);
    });
    return result;
  },
  buildSidebarTablePinKey: (
    connectionId: string,
    dbName: string,
    tableName: string,
    schemaName = '',
  ) => JSON.stringify([
    connectionId.trim(),
    dbName.trim(),
    schemaName.trim(),
    tableName.trim(),
  ]),
  useStore: (selector: (state: any) => any) => selector({
    connections: mocks.state.connections,
    savedQueries: [],
    savedQueryGroups: [],
    externalSQLDirectories: [],
    saveQuery: mocks.noop,
    deleteQuery: mocks.noop,
    saveSavedQueryGroup: mocks.noop,
    deleteSavedQueryGroup: mocks.noop,
    moveSavedQueryToGroup: mocks.noop,
    reloadSavedQueryGroups: mocks.noop,
    saveExternalSQLDirectory: mocks.noop,
    deleteExternalSQLDirectory: mocks.noop,
    addConnection: mocks.noop,
    addTab: mocks.noop,
    updateQueryTabDraft: mocks.noop,
    tabs: mocks.state.tabs,
    activeTabId: mocks.state.activeTabId,
    setActiveContext: mocks.noop,
    removeConnection: mocks.noop,
    connectionTags: mocks.state.connectionTags,
    sidebarRootOrder: [],
    addConnectionTag: mocks.noop,
    updateConnectionTag: mocks.noop,
    removeConnectionTag: mocks.noop,
    moveConnectionToTag: mocks.noop,
    moveConnectionTag: mocks.noop,
    reorderConnections: mocks.noop,
    reorderTags: mocks.noop,
    reorderSidebarRoot: mocks.noop,
    closeTabsByConnection: mocks.noop,
    closeTabsByDatabase: mocks.noop,
    theme: 'light',
    appearance: mocks.state.appearance,
    activeContext: mocks.state.activeContext,
    tableAccessCount: {},
    tableSortPreference: {},
    pinnedSidebarTables: [],
    recordTableAccess: mocks.noop,
    setTableSortPreference: mocks.noop,
    setSidebarTablePinned: mocks.noop,
    queryOptions: { showSidebarTableComment: false },
    setQueryOptions: mocks.noop,
    addSqlLog: mocks.noop,
    sqlLogs: [],
    shortcutOptions: mocks.state.shortcutOptions ?? cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS),
    setAIPanelVisible: mocks.noop,
    addAIContext: mocks.noop,
  }),
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  DBGetDatabases: mocks.noop,
  DBGetTables: mocks.noop,
  DBQuery: mocks.noop,
  DBShowCreateTable: mocks.noop,
  DBReleaseConnection: mocks.noop,
  ExportTable: mocks.noop,
  OpenSQLFile: mocks.noop,
  ExecuteSQLFile: mocks.noop,
  CancelSQLFileExecution: mocks.noop,
  CreateDatabase: mocks.noop,
  CreateSchema: mocks.noop,
  RenameDatabase: mocks.noop,
  DropDatabase: mocks.noop,
  RenameTable: mocks.noop,
  DropTable: mocks.noop,
  DropView: mocks.noop,
  DropFunction: mocks.noop,
  RenameView: mocks.noop,
  SelectSQLDirectory: mocks.noop,
  ListSQLDirectory: mocks.noop,
  ReadSQLFile: mocks.noop,
  CreateSQLFile: mocks.noop,
  CreateSQLDirectory: mocks.noop,
  DeleteSQLFile: mocks.noop,
  DeleteSQLDirectory: mocks.noop,
  RenameSQLFile: mocks.noop,
  RenameSQLDirectory: mocks.noop,
  JVMProbeCapabilities: mocks.noop,
  GetDriverStatusList: mocks.noop,
}));

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: mocks.noop,
}));

vi.mock('../utils/appearance', async () => {
  const actual = await vi.importActual<typeof import('../utils/appearance')>('../utils/appearance');
  return {
    ...actual,
    isMacLikePlatform: () => true,
  };
});

type SidebarTestLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const renderSidebarMarkup = (
  props: React.ComponentProps<typeof Sidebar> = {},
  language: SidebarTestLanguage = getCurrentLanguage(),
) => renderToStaticMarkup(
  <I18nProvider
    preference={language}
    systemLanguages={[language]}
    onPreferenceChange={() => undefined}
  >
    <Sidebar {...props} />
  </I18nProvider>,
);

describe('Sidebar locate toolbar', () => {
  beforeEach(() => {
    setCurrentLanguage('zh-CN');
    mocks.state.connections = [];
    mocks.state.activeContext = null;
    mocks.state.activeTabId = 'conn-1-main-users';
    mocks.state.tabs = [{
      id: 'conn-1-main-users',
      title: 'users',
      type: 'table',
      connectionId: 'conn-1',
      dbName: 'main',
      tableName: 'users',
    }];
    mocks.state.connectionTags = [];
    mocks.state.appearance = {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'legacy',
      sidebarHiddenObjectGroups: [],
    };
    mocks.state.shortcutOptions = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
  });

  it('resolves the table name used by the sidebar copy action', () => {
    expect(resolveSidebarTableNameForCopy({
      title: 'users',
      dataRef: { tableName: 'public.users' },
    })).toBe('public.users');
    expect(resolveSidebarTableNameForCopy({
      title: 'v_users',
      dataRef: { viewName: 'reporting.v_users' },
    })).toBe('reporting.v_users');
    expect(resolveSidebarTableNameForCopy({
      title: 'users',
      dataRef: {},
    })).toBe('users');
  });

  it('treats empty lazy children as unloaded for sidebar expansion', () => {
    expect(hasSidebarLazyChildren(undefined)).toBe(false);
    expect(hasSidebarLazyChildren([])).toBe(false);
    expect(hasSidebarLazyChildren([{ key: 'child', title: 'child' }])).toBe(true);
    expect(shouldLoadSidebarNodeOnExpand({ type: 'database', children: [] })).toBe(true);
    expect(shouldLoadSidebarNodeOnExpand({ type: 'database', children: [{ key: 'tables', title: '表' }] })).toBe(false);
    expect(shouldLoadSidebarNodeOnExpand({ type: 'object-group', children: [] })).toBe(false);
  });

  it('keeps sidebar switchers collapsed while lazy loading is still pending', () => {
    const connectionNode = {
      key: 'conn-1',
      data: {
        key: 'conn-1',
        title: '开发240',
        type: 'connection' as const,
        dataRef: { id: 'conn-1' },
      },
      expanded: true,
    };
    const databaseNode = {
      key: 'conn-1-main',
      data: {
        key: 'conn-1-main',
        title: 'main',
        type: 'database' as const,
        dataRef: { id: 'conn-1', dbName: 'main' },
      },
      expanded: true,
    };

    expect(resolveSidebarSwitcherLoadKey(connectionNode)).toBe('dbs-conn-1');
    expect(resolveSidebarSwitcherLoadKey(databaseNode)).toBe('tables-conn-1-main');
    expect(shouldKeepSidebarSwitcherCollapsedWhileLoading(connectionNode, new Set(['dbs-conn-1']))).toBe(true);
    expect(shouldKeepSidebarSwitcherCollapsedWhileLoading(databaseNode, new Set(['tables-conn-1-main']))).toBe(true);
    expect(shouldKeepSidebarSwitcherCollapsedWhileLoading({
      key: 'table-users',
      data: {
        key: 'table-users',
        title: 'users',
        type: 'table' as const,
        dataRef: { id: 'conn-1', dbName: 'main', tableName: 'users' },
      },
      loading: true,
    }, new Set())).toBe(true);
    expect(shouldKeepSidebarSwitcherCollapsedWhileLoading(databaseNode, new Set())).toBe(false);
  });

  it('wires tree expand and double-click expansion to lazy loading', () => {
    const source = readSidebarSource();

    expect(source).toContain('if (hasSidebarLazyChildren(children)) return;');
    expect(source).toContain('if (!info?.expanded && shouldClearSidebarNodeChildrenOnCollapse(info?.node))');
    expect(source).toContain('...collectSidebarSubtreeKeys(info.node)');
    expect(source).toContain('clearTreeNodeChildrenByKeys(keysToClear);');
    expect(source).toContain('if (!shouldSkipSidebarLoadOnExpandWhileDragging(isTreeDragging, info))');
    expect(source).toContain('if (shouldLoadSidebarNodeOnExpand(node))');
    expect(source).toContain('const keepCollapsed = shouldKeepSidebarSwitcherCollapsedWhileLoading(node, loadingNodesRef.current);');
    expect(source).toContain('return <CaretDownFilled rotate={keepCollapsed ? -90 : undefined} />;');
    expect(source).toContain('switcherIcon={renderSidebarSwitcherIcon}');
  });

  it('uses the appearance preference to switch table double-click to the embedded object designer', () => {
    const source = readSidebarSource();

    expect(source).toContain("const tableDoubleClickAction = appearance.tableDoubleClickAction === 'open-design' ? 'open-design' : 'open-data';");
    expect(source).toContain("type: 'table',");
    expect(source).toContain("initialViewMode: tableDoubleClickAction === 'open-design' ? 'fields' : undefined");
    expect(source).toContain("initialViewModeRequestId: tableDoubleClickAction === 'open-design' ? String(Date.now()) : undefined");
    expect(source).not.toContain("if (tableDoubleClickAction === 'open-design') {\n              openDesign(node, 'columns', false);");
    expect(source).toContain('recordTableAccess(id, dbName, tableName);');
  });

  it('parses v2 command search prefixes into real search modes', () => {
    expect(parseV2CommandSearchQuery('@ payment_order')).toMatchObject({
      mode: 'object',
      keyword: 'payment_order',
      normalizedKeyword: 'payment_order',
      aiPrompt: '',
    });
    expect(parseV2CommandSearchQuery('＠fs_mkefu_server_info')).toMatchObject({
      mode: 'object',
      keyword: 'fs_mkefu_server_info',
    });
    expect(parseV2CommandSearchQuery('? 帮我分析订单表')).toMatchObject({
      mode: 'ai',
      keyword: '帮我分析订单表',
      normalizedKeyword: '帮我分析订单表',
      aiPrompt: '帮我分析订单表',
    });
    expect(parseV2CommandSearchQuery('payment')).toMatchObject({
      mode: 'default',
      keyword: 'payment',
      normalizedKeyword: 'payment',
    });
  });

  it('only runs v2 command search enter for a real selected result outside IME composition', () => {
    expect(shouldRunV2CommandSearchEnter({
      key: 'Enter',
      activeItemCount: 1,
    })).toBe(true);
    expect(shouldRunV2CommandSearchEnter({
      key: 'Enter',
      isComposing: true,
      activeItemCount: 1,
    })).toBe(false);
    expect(shouldRunV2CommandSearchEnter({
      key: 'Enter',
      keyCode: 229,
      activeItemCount: 1,
    })).toBe(false);
    expect(shouldRunV2CommandSearchEnter({
      key: 'Enter',
      activeItemCount: 0,
    })).toBe(false);
    expect(shouldRunV2CommandSearchEnter({
      key: 'Escape',
      activeItemCount: 1,
    })).toBe(false);
  });

  it('keeps v2 command search persisted filter after closing the palette', () => {
    expect(resolveV2CommandSearchPersistentFilter({
      commandSearchValue: '  org  ',
      persistedFilter: '',
      enabled: true,
      isOpen: true,
    })).toBe('org');

    expect(resolveV2CommandSearchPersistentFilter({
      commandSearchValue: '',
      persistedFilter: 'org',
      enabled: true,
      isOpen: false,
    })).toBe('org');

    expect(resolveV2CommandSearchPersistentFilter({
      commandSearchValue: 'org',
      persistedFilter: 'org',
      enabled: false,
      isOpen: true,
    })).toBe('');
  });

  it('closes v2 command search on global escape only while the palette is open', () => {
    expect(shouldCloseV2CommandSearchOnGlobalKey({
      key: 'Escape',
      isOpen: true,
    })).toBe(true);

    expect(shouldCloseV2CommandSearchOnGlobalKey({
      key: 'Esc',
      isOpen: true,
    })).toBe(true);

    expect(shouldCloseV2CommandSearchOnGlobalKey({
      key: 'Escape',
      isOpen: false,
    })).toBe(false);

    expect(shouldCloseV2CommandSearchOnGlobalKey({
      key: 'Enter',
      isOpen: true,
    })).toBe(false);
  });

  it('keeps all loaded v2 command table matches once a keyword is entered', () => {
    const items: V2CommandSearchItem[] = Array.from({ length: 40 }, (_, index) => ({
      key: `node-table-${index}`,
      kind: 'node' as const,
      title: `fs_order_${index}`,
      meta: '开发240 · front_end_sys',
      icon: null,
      node: {
        type: 'table',
        key: `table-${index}`,
        title: `fs_order_${index}`,
        dataRef: {
          tableName: `fs_order_${index}`,
          dbName: 'front_end_sys',
        },
      },
    }));

    expect(filterV2CommandSearchTreeItems(
      items,
      parseV2CommandSearchQuery('fs_order'),
    )).toHaveLength(40);
    expect(filterV2CommandSearchTreeItems(
      items,
      parseV2CommandSearchQuery(''),
    )).toHaveLength(24);
    expect(filterV2CommandSearchTreeItems(
      [
        ...items,
        {
          key: 'node-db',
          kind: 'node' as const,
          title: 'front_end_sys',
          meta: '开发240',
          icon: null,
          node: {
            type: 'database',
            key: 'db-front-end-sys',
            title: 'front_end_sys',
            dataRef: {
              dbName: 'front_end_sys',
            },
          },
        },
      ],
      parseV2CommandSearchQuery('@fs_order'),
    )).toHaveLength(40);
  });

  it('keeps the v2 active host on the selected database connection', () => {
    const connectionIds = ['local', 'dev240', 'dev241'];
    const databaseNode = {
      key: 'dev240-manage_admin',
      dataRef: {
        id: 'dev240',
        dbName: 'manage_admin',
      },
    };

    expect(resolveSidebarNodeConnectionId(databaseNode, connectionIds)).toBe('dev240');
    expect(resolveV2ActiveConnectionId({
      activeContextConnectionId: '',
      activeTabConnectionId: 'local',
      selectedKeys: [databaseNode.key],
      connectionIds,
    })).toBe('dev240');
  });

  it('keeps the v2 active host on the pinned rail connection after tree deselect', () => {
    expect(resolveV2ActiveConnectionId({
      activeContextConnectionId: '',
      activeTabConnectionId: 'local',
      selectedKeys: [],
      connectionIds: ['local', 'dev240', 'dev241'],
      fallbackConnectionId: 'dev240',
    })).toBe('dev240');
  });

  it('keeps the v2 active host empty when nothing is selected', () => {
    expect(resolveV2ActiveConnectionId({
      activeContextConnectionId: '',
      activeTabConnectionId: '',
      selectedKeys: [],
      connectionIds: ['local', 'dev240', 'dev241'],
    })).toBe('');
  });

  it('does not clear v2 active context when rc-tree emits an empty deselect', () => {
    expect(shouldClearSidebarActiveContextOnEmptySelect(true)).toBe(false);
    expect(shouldClearSidebarActiveContextOnEmptySelect(false)).toBe(true);
  });

  it('builds v2 rail groups from existing connection tags while preserving ungrouped hosts', () => {
    const connections = [
      { id: 'dev240', name: 'dev240', config: { type: 'mysql', host: '10.0.0.240' } },
      { id: 'dev241', name: 'dev241', config: { type: 'postgres', host: '10.0.0.241' } },
      { id: 'local', name: 'local', config: { type: 'mysql', host: 'localhost' } },
    ] as any[];

    const groups = buildV2RailConnectionGroups(
      connections,
      [{
        id: 'prod',
        name: '生产环境',
        connectionIds: ['dev241', 'missing', 'dev240'],
      }],
      [
        buildSidebarRootConnectionToken('local'),
        buildSidebarRootTagToken('prod'),
      ],
    );

    expect(groups.map((group) => ({
      id: group.id,
      name: group.name,
      isUngrouped: group.isUngrouped,
      rootToken: group.rootToken,
      connectionIds: group.connections.map((conn) => conn.id),
    }))).toEqual([
      {
        id: 'local',
        name: 'local',
        isUngrouped: true,
        rootToken: buildSidebarRootConnectionToken('local'),
        connectionIds: ['local'],
      },
      {
        id: 'prod',
        name: '生产环境',
        isUngrouped: undefined,
        rootToken: buildSidebarRootTagToken('prod'),
        connectionIds: ['dev241', 'dev240'],
      },
    ]);
    expect(getV2RailConnectionGroupBadgeText('Production')).toBe('PR');
    expect(getV2RailConnectionGroupBadgeText('生产环境')).toBe('生');
  });

  it('builds arbitrarily nested host groups with mixed host and subgroup order', () => {
    const connections = [
      'host1', 'host2', 'host3', 'host4', 'host5', 'host6',
    ].map((id) => ({ id, name: id, config: { type: 'mysql', host: `${id}.local` } })) as any[];
    const tags = [
      {
        id: 'group-1',
        name: '分组1',
        connectionIds: ['host1', 'host2'],
        childOrder: ['connection:host1', 'connection:host2', 'tag:group-1-1'],
      },
      {
        id: 'group-1-1',
        name: '分组1-1',
        parentTagId: 'group-1',
        connectionIds: ['host3', 'host4'],
        childOrder: ['connection:host3', 'connection:host4', 'tag:group-1-1-1'],
      },
      {
        id: 'group-1-1-1',
        name: '分组1-1-1',
        parentTagId: 'group-1-1',
        connectionIds: ['host5', 'host6'],
        childOrder: ['connection:host5', 'connection:host6'],
      },
    ] as any[];

    const outline = (items: ReturnType<typeof buildSidebarConnectionTagTree>): unknown[] => items.map((item) => (
      item.kind === 'connection'
        ? item.id
        : { id: item.id, children: outline(item.children) }
    ));

    expect(outline(buildSidebarConnectionTagTree(connections, tags, ['tag:group-1']))).toEqual([
      {
        id: 'group-1',
        children: [
          'host1',
          'host2',
          {
            id: 'group-1-1',
            children: [
              'host3',
              'host4',
              { id: 'group-1-1-1', children: ['host5', 'host6'] },
            ],
          },
        ],
      },
    ]);
    expect(isConnectionTagDescendant('group-1', 'group-1-1-1', tags)).toBe(true);
    expect(isConnectionTagDescendant('group-1-1', 'group-1', tags)).toBe(false);
  });

  it('keeps malformed group parents and parent cycles visible at the root', () => {
    const tags = [
      { id: 'a', name: 'A', parentTagId: 'b', connectionIds: [] },
      { id: 'b', name: 'B', parentTagId: 'a', connectionIds: [] },
      { id: 'orphan', name: 'Orphan', parentTagId: 'missing', connectionIds: [] },
    ] as any[];

    expect(
      buildSidebarConnectionTagTree([], tags, []).map((item) => item.id),
    ).toEqual(['a', 'b', 'orphan']);
  });

  it('keeps the sidebar memoized so parent-only button state does not repaint the tree', () => {
    const source = readSidebarSource();

    expect(source).toContain('}> = React.memo(({');
  });

  it('builds a standalone saved-query tree without loading database nodes', () => {
    const tree = buildAllSavedQueriesTreeNode(
      [
        {
          id: 'saved-1',
          name: 'Orders',
          sql: 'select * from orders',
          connectionId: 'conn-1',
          dbName: 'app',
          createdAt: 100,
        },
        {
          id: 'saved-orphan',
          name: 'Legacy Report',
          sql: 'select 1',
          connectionId: 'legacy-1',
          originalConnectionId: 'legacy-1',
          dbName: 'legacy_db',
          createdAt: 200,
          bindingStatus: 'orphan',
        },
      ],
      [{
        id: 'conn-1',
        name: 'Primary',
        config: {
          type: 'mysql',
          host: 'db.local',
          port: 3306,
        },
      }] as any,
    );

    expect(tree?.key).toBe('all-saved-queries');
    expect(tree?.title).toBe('全部已存查询');
    expect(tree?.children?.[0]).toMatchObject({
      key: 'all-saved-queries-connection-conn-1',
      title: 'Primary',
      type: 'saved-query-group',
    });
    expect(tree?.children?.[0].children?.[0]).toMatchObject({
      key: 'all-saved-queries-connection-conn-1-db-app',
      title: 'app',
    });
    expect(tree?.children?.[0].children?.[0].children?.[0]).toMatchObject({
      key: 'all-saved-query-saved-1',
      title: 'Orders',
      type: 'saved-query',
    });
    const unmatchedGroup = tree?.children?.find((child) => child.key === 'all-saved-queries-unmatched');
    expect(unmatchedGroup?.title).toBe('未匹配');
    expect(unmatchedGroup?.children?.[0]).toMatchObject({
      key: 'all-saved-queries-unmatched-legacy-1',
      title: 'legacy-1',
    });
    expect(unmatchedGroup?.children?.[0].children?.[0].children?.[0]).toMatchObject({
      key: 'all-saved-query-saved-orphan',
      title: 'Legacy Report',
    });
  });

  it('renders saved query groups in mixed child order and keeps grouped SQL out of the ungrouped branch', () => {
    const tree = buildAllSavedQueriesTreeNode(
      [
        {
          id: 'query-root',
          name: 'Root query',
          sql: 'select 1',
          connectionId: 'conn-1',
          dbName: 'app',
          createdAt: 100,
        },
        {
          id: 'query-child',
          name: 'Child query',
          sql: 'select 2',
          connectionId: 'conn-1',
          dbName: 'app',
          createdAt: 200,
        },
        {
          id: 'query-ungrouped',
          name: 'Ungrouped query',
          sql: 'select 3',
          connectionId: 'conn-1',
          dbName: 'app',
          createdAt: 300,
        },
      ],
      [{
        id: 'conn-1',
        name: 'Primary',
        config: { type: 'mysql', host: 'db.local', port: 3306 },
      }] as any,
      [
        {
          id: 'root-group',
          name: 'Root group',
          queryIds: ['query-root'],
          childOrder: ['group:child-group', 'query:query-root'],
        },
        {
          id: 'child-group',
          name: 'Child group',
          parentGroupId: 'root-group',
          queryIds: ['query-child'],
          childOrder: ['query:query-child'],
        },
      ],
    );

    const rootGroup = tree?.children?.find((child) => child.key === 'saved-query-manual-group-root-group');
    expect(rootGroup?.children?.map((child) => child.key)).toEqual([
      'saved-query-manual-group-child-group',
      'all-saved-query-query-root',
    ]);
    expect(rootGroup?.children?.[0].children?.map((child) => child.key)).toEqual([
      'all-saved-query-query-child',
    ]);

    const ungrouped = tree?.children?.find((child) => child.key === 'all-saved-queries-ungrouped');
    expect(ungrouped?.children?.[0]).toMatchObject({
      key: 'all-saved-queries-connection-conn-1',
      title: 'Primary',
    });
    expect(ungrouped?.children?.[0].children?.[0].children?.map((child) => child.key)).toEqual([
      'all-saved-query-query-ungrouped',
    ]);
    expect(JSON.stringify(ungrouped)).not.toContain('all-saved-query-query-root');
    expect(JSON.stringify(ungrouped)).not.toContain('all-saved-query-query-child');
  });

  it('releases backend database connections when disconnecting a sidebar connection', () => {
    const source = readSidebarSource();
    const disconnectSource = source.slice(
      source.indexOf('const releaseConnectionResources = async'),
      source.indexOf('const deleteConnectionNode ='),
    );

    expect(source).toContain('DBReleaseConnection');
    expect(disconnectSource).toContain('await releaseConnectionResources(conn);');
    expect(source.match(/onClick: \(\) => void disconnectConnectionNode\(node\)/g)).toHaveLength(2);
  });

  it('renders the current table locate action in the sidebar toolbar', () => {
    const markup = renderSidebarMarkup();
    const externalSqlActionIndex = markup.indexOf('data-sidebar-open-external-sql-file-action="true"');
    const locateActionIndex = markup.indexOf('data-sidebar-locate-current-tab-action="true"');

    expect(markup).toContain('data-sidebar-locate-current-tab-action="true"');
    expect(markup).toContain('aria-label="定位当前标签页"');
    expect(locateActionIndex).toBeGreaterThan(externalSqlActionIndex);
  });

  it('passes the exact tree key when locating a command-search object node', () => {
    const source = readSidebarSource();
    const commandSearchRunSource = source.slice(
      source.indexOf("if (node.type === 'table' || node.type === 'view' || node.type === 'materialized-view')"),
      source.indexOf("if (node.type === 'db-trigger' || node.type === 'db-event' || node.type === 'routine' || node.type === 'sequence' || node.type === 'package')"),
    );

    expect(commandSearchRunSource).toContain("tabId: String(node.key || '')");
  });

  it('opens view routine and trigger nodes from single-click selection', () => {
    const source = readSidebarSource();
    const openObjectSource = source.slice(
      source.indexOf('const openSidebarObjectNode ='),
      source.indexOf('const onSelect ='),
    );
    const onSelectSource = source.slice(
      source.indexOf('const onSelect ='),
      source.indexOf('const onExpand ='),
    );

    expect(openObjectSource).toContain("node.type === 'view' || node.type === 'materialized-view'");
    expect(openObjectSource).toContain("node.type === 'db-trigger'");
    expect(openObjectSource).toContain("node.type === 'routine'");
    expect(openObjectSource).toContain("type: 'table'");
    expect(openObjectSource).toContain("type: 'trigger'");
    expect(openObjectSource).toContain("type: 'routine-def'");
    expect(onSelectSource).toContain('openSidebarObjectNode(info.node)');
  });

  it('opens event edit menu with editable object SQL instead of a SHOW query', () => {
    const sidebarSource = readSidebarSource();
    const menuSource = readSourceFile('./sidebar/sidebarLegacyNodeMenu.tsx');
    const actionsSource = readSourceFile('./sidebar/useSidebarObjectActions.tsx');
    const eventMenuSource = menuSource.slice(
      menuSource.indexOf("} else if (node.type === 'db-event') {"),
      menuSource.indexOf("} else if (node.type === 'table') {"),
    );

    expect(sidebarSource).toContain('openEditEvent,');
    expect(eventMenuSource).toContain('onClick: () => void openEditEvent(node)');
    expect(eventMenuSource).not.toContain('SHOW CREATE EVENT');
    expect(actionsSource).toContain('const openEditEvent = async (node: any) =>');
    expect(actionsSource).toContain("queryMode: 'object-edit'");
    expect(actionsSource).toContain('SHOW CREATE EVENT ${eventRef}');
  });

  it('marks sidebar view and routine edits as object-edit query tabs', () => {
    const actionsSource = readSourceFile('./sidebar/useSidebarObjectActions.tsx');
    const viewEditSource = actionsSource.slice(
      actionsSource.indexOf('const openEditView = async (node: any) => {'),
      actionsSource.indexOf('const openCreateView = (node: any) => {'),
    );
    const routineEditSource = actionsSource.slice(
      actionsSource.indexOf('const openEditRoutine = async (node: any) => {'),
      actionsSource.indexOf('const openCreateRoutine = (node: any, type: \'FUNCTION\' | \'PROCEDURE\') => {'),
    );

    expect(viewEditSource).toContain("id: `query-edit-view-${Date.now()}`");
    expect(viewEditSource).toContain("queryMode: 'object-edit'");
    expect(routineEditSource).toContain("id: `query-edit-routine-${Date.now()}`");
    expect(routineEditSource).toContain("queryMode: 'object-edit'");
  });

  it('wires external SQL directory file actions to dedicated Wails APIs', () => {
    const source = readSidebarSource();
    const loadTablesSource = source.slice(
      source.indexOf('const loadTables = async'),
      source.indexOf('const locateObjectInSidebarRef'),
    );

    expect(source).toContain('CreateSQLFile(directoryPath, name)');
    expect(source).toContain('RenameSQLFile(filePath, name)');
    expect(source).toContain('DeleteSQLFile(filePath)');
    expect(source).toContain('CreateSQLDirectory(directoryPath, name)');
    expect(source).toContain('RenameSQLDirectory(directoryPath, name)');
    expect(source).toContain('DeleteSQLDirectory(directoryPath)');
    expect(source).toContain('refreshGlobalExternalSQLRootNode(false)');
    expect(source).toContain("request.objectGroup === 'externalSqlFiles'");
    expect(source).toContain("t('sidebar.message.locate_external_sql_file_not_found', { path: request.filePath })");
    expect(source).toContain('filePath: data.filePath || undefined');
    expect(source).toContain("key: 'add-external-sql-directory'");
    expect(source).toContain("key: 'new-external-sql-file'");
    expect(source).toContain("key: 'rename-external-sql-file'");
    expect(source).toContain("key: 'delete-external-sql-file'");
    expect(source).toContain("key: 'new-external-sql-directory'");
    expect(source).toContain("key: 'rename-external-sql-directory'");
    expect(source).toContain("key: 'delete-external-sql-directory'");
    expect(source).toContain("t('sidebar.external_sql_modal.title.create_file')");
    expect(source).toContain("t('sidebar.external_sql_modal.title.rename_file')");
    expect(source).toContain("t('sidebar.modal.confirm_delete_sql_file.title')");
    expect(source).toContain("t('sidebar.external_sql_modal.title.create_directory')");
    expect(source).toContain("t('sidebar.external_sql_modal.title.rename_directory')");
    expect(source).toContain("t('sidebar.modal.confirm_delete_sql_directory.title')");
    expect(source).toContain("t('sidebar.modal.confirm_delete_sql_directory.content', { name: directoryName })");
    expect(source).toContain("t('sidebar.external_sql_modal.validation.sql_file_name_no_separator')");
    expect(source).toContain("t('sidebar.external_sql_modal.validation.directory_name_no_separator')");
  });

  it('keeps the legacy sidebar toolbar on a stable six-column grid layout', () => {
    const source = readSidebarSource();
    const markup = renderSidebarMarkup();

    expect(markup).toContain('data-sidebar-legacy-toolbar="true"');
    expect(markup).toContain('data-sidebar-legacy-toolbar-item="true"');
    expect(source).toContain("const legacyToolbarStyle: React.CSSProperties = {");
    expect(source).toContain("gridTemplateColumns: 'repeat(6, minmax(0, 1fr))'");
    expect(source).toContain("justifyItems: 'center'");
    expect(source).toContain("const legacyToolbarItemStyle: React.CSSProperties = {");
    expect(source).toContain("const legacyToolbarDisabledWrapStyle: React.CSSProperties = {");
    expect(source).not.toContain("justifyContent: 'space-between', borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`, borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`, background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.015)' }}>");
  });

  it('keeps only the unified settings entry in sidebar utility areas', () => {
    const sidebarSource = readSourceFile('./Sidebar.tsx');
    const railSource = readSourceFile('./sidebar/SidebarConnectionRail.tsx');

    expect(sidebarSource).not.toContain('onOpenTools');
    expect(sidebarSource).not.toContain('openTools:');
    expect(railSource).not.toContain('handlers.openTools');
    expect(railSource).not.toContain('data-gonavi-open-tools-action');
    expect(railSource).toContain('handlers.openSettings');
  });

  it('renders the fixed v2 rail, explorer filters and workbench actions', () => {
    const markup = renderSidebarMarkup({ uiVersion: 'v2', onCreateConnection: mocks.noop });
    const collapsedMarkup = renderSidebarMarkup({ uiVersion: 'v2', isTreePanelCollapsed: true });
    const source = readSidebarSource();

    expect(markup).toContain('gn-v2-sidebar-redesign');
    expect(markup).toContain('gn-v2-connection-rail');
    expect(markup).toContain('data-sidebar-fixed-rail="true"');
    expect(markup).toContain('gn-v2-object-explorer');
    expect(markup.indexOf('data-sidebar-fixed-rail="true"')).toBeLessThan(markup.indexOf('data-sidebar-tree-panel="true"'));
    expect(collapsedMarkup).toContain('data-sidebar-fixed-rail="true"');
    expect(collapsedMarkup).toContain('data-sidebar-tree-panel="true" aria-hidden="true" style="display:none');
    expect(markup).toContain('gn-v2-active-connection-header');
    expect(markup).toContain('gn-v2-explorer-search');
    expect(markup).toContain('data-v2-sidebar-search-mode="command"');
    expect(markup).toContain('gn-v2-explorer-command-trigger');
    expect(markup).toContain('gn-v2-explorer-filter-action');
    expect(markup).toContain('重置侧栏筛选');
    expect(markup).toContain('搜索表、连接、动作... 或问 AI');
    expect(markup).toContain('gn-v2-search-shortcut');
    expect(markup).toContain('<kbd>⌘</kbd>');
    expect(markup).toContain('<kbd>K</kbd>');
    expect(source).toContain("const focusSidebarSearchShortcut = resolveShortcutDisplay(shortcutOptions, 'focusSidebarSearch', activeShortcutPlatform);");
    expect(source).not.toContain('<kbd>⌘</kbd>');
    expect(source).not.toContain('<kbd>K</kbd>');
    expect(markup).toContain('gn-v2-explorer-filter-tabs');
    expect(markup).toContain('全部');
    expect(markup).toContain('视图');
    expect(markup).toContain('函数');
    expect(markup).toContain('aria-pressed="true"');
    expect(source).toContain("const [v2ExplorerFilter, setV2ExplorerFilter] = useState<V2ExplorerFilter>('all');");
    expect(source).toContain("const v2SidebarSearchMode = appearance.v2SidebarSearchMode ?? 'command';");
    expect(source).toContain('const v2CommandSearchPersistentFilterEnabled = appearance.v2CommandSearchPersistentFilterEnabled === true;');
    expect(source).toContain('onSearchValueChange: handleV2CommandSearchValueChange,');
    expect(source).toContain('handlers.onSearchValueChange(event.target.value)');
    expect(source).toContain('toggleV2CommandSearchPersistentFilter');
    expect(source).toContain('gn-v2-command-filter-switch');
    expect(source).toContain("window.addEventListener('keydown', handleV2CommandSearchGlobalKeyDown, true)");
    expect(source).toContain("window.removeEventListener('keydown', handleV2CommandSearchGlobalKeyDown, true)");
    expect(source).toContain('onClick={() => setV2ExplorerFilter(item.key)}');
    expect(source).toContain('treeData={isV2Ui ? v2VisibleTreeData : displayTreeData}');
    expect(markup).toContain('gn-v2-rail-workbench-actions');
    expect(markup).toContain('data-sidebar-sql-analysis-action="true"');
    expect(markup).toContain('data-sidebar-sql-audit-action="true"');
    expect(markup).not.toContain('gn-v2-sidebar-log-footer');
    expect(markup).not.toContain('gn-v2-sidebar-slow-query-button');
    expect(markup).not.toContain('gn-v2-sidebar-log-button');
    expect(markup).not.toContain('SQL 执行日志');
    expect(markup).not.toContain('2,341');
    expect(markup).toContain('gn-v2-rail-items');
    expect(source).toContain('className="gn-v2-rail-primary-actions"');
    expect(markup).toContain('data-sidebar-create-group-action="true"');
    expect(markup).toContain('data-sidebar-batch-table-action="true"');
    expect(markup).toContain('data-sidebar-batch-database-action="true"');
    expect(markup).toContain('data-sidebar-data-import-action="true"');
    expect(source).toContain('openBatchTableExport: openBatchTableWorkbench,');
    expect(source).toContain('openBatchDatabaseExport: openBatchDatabaseWorkbench,');
    expect(source).toContain('openDataImport: handleOpenDataImportWorkbench,');
    expect(source).toContain('onClick={openBatchTableWorkbench}');
    expect(source).toContain('onClick={openBatchDatabaseWorkbench}');
    expect(source).not.toContain('openBatchOperationModal');
    expect(source).not.toContain('openBatchDatabaseModal');
    expect(markup).toContain('data-sidebar-open-external-sql-file-action="true"');
    expect(markup).toContain('data-sidebar-locate-current-tab-action="true"');
    expect(markup).toContain('data-gonavi-new-query-action="true"');
    expect(markup).toContain('data-gonavi-create-connection-action="true"');
    expect(markup).toContain('aria-label="AI 助手"');
    expect(markup).toContain('data-gonavi-ai-entry-action="true"');
    expect(markup).not.toContain('aria-label="工具"');
    expect(markup).not.toContain('data-gonavi-open-tools-action="true"');
    expect(markup).toContain('aria-label="设置"');
    expect(source).not.toContain('handlers.openTools');
    expect(source).toContain('export const buildV2RailConnectionGroups = (');
    expect(source).toContain("if (menu.kind === 'v2-connection-group') return renderV2ConnectionGroupContextMenu(menu.node);");
    expect(source).toContain('openV2ConnectionContextMenu(event, node);');
    expect(source).toContain("kind: 'v2-connection'");
    expect(source).toContain('resolveSidebarContextMenuPosition(event.clientX, event.clientY)');
    expect(source).toContain('contextMenuPortalRef');
    expect(source).toContain('createPortal(');
    expect(source).toContain('gn-v2-sidebar-context-menu-portal');
    expect(source).toContain('getBoundingClientRect()');
    expect(source).toContain("querySelector('.gn-v2-table-context-menu')");
    expect(source).toContain('content?.scrollHeight');
    expect(source).toContain("if (menu.kind === 'v2-connection') return renderV2ConnectionContextMenu(menu.node);");
    expect(source).toContain('sourceX: event.clientX');
    expect(source).toContain("['--gn-v2-context-menu-max-height' as any]");
    expect(source).toContain('{contextMenu && !contextMenu.kind && (');
    expect(source).not.toContain("document.addEventListener('contextmenu', onPointerDown)");
    const contextMenuFunction = source.slice(
      source.indexOf('const openV2ConnectionContextMenu = ('),
      source.indexOf('const getV2TreeMetaText = (node: any): string => {'),
    );
    expect(contextMenuFunction).not.toContain('setSelectedKeys');
    expect(contextMenuFunction).not.toContain('selectedNodesRef.current');
    expect(contextMenuFunction).not.toContain('setActiveContext');
  });

  it('can render the v2 sidebar with legacy persistent filter input', () => {
    mocks.state.appearance.v2SidebarSearchMode = 'filter';
    mocks.state.appearance.v2SidebarPersistedFilter = 'fs_org';

    const markup = renderSidebarMarkup({ uiVersion: 'v2' });

    expect(markup).toContain('data-v2-sidebar-search-mode="filter"');
    expect(markup).toContain(`placeholder="${t('sidebar.search.placeholder')}"`);
    expect(markup).toContain('value="fs_org"');
    expect(markup).toContain('重置侧栏筛选');
  });

  it('renders the v2 search shortcut from the user shortcut settings', () => {
    mocks.state.shortcutOptions = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    mocks.state.shortcutOptions.focusSidebarSearch.mac = { combo: 'Meta+F', enabled: true };

    const markup = renderSidebarMarkup({ uiVersion: 'v2' });

    expect(markup).toContain('gn-v2-search-shortcut');
    expect(markup).toContain('<kbd>⌘</kbd>');
    expect(markup).toContain('<kbd>F</kbd>');
    expect(markup).not.toContain('<kbd>K</kbd>');
  });

  it('localizes the v2 command search scope shell and object filters through catalog keys', () => {
    const source = readSidebarSource();
    const objectKindSource = source.slice(
      source.indexOf('const V2_EXPLORER_FILTER_OPTIONS'),
      source.indexOf('const V2_EXPLORER_FILTER_GROUP_KEYS'),
    );
    const searchScopeSource = source.slice(
      source.indexOf('const SEARCH_SCOPE_OPTIONS'),
      source.indexOf('const SEARCH_SCOPE_ICON_MAP'),
    );
    const scopePanelSource = source.slice(
      source.indexOf('const currentLanguage = getCurrentLanguage();'),
      source.indexOf('const getConnectionHostSearchText = (node: TreeNode): string => {'),
    );
    const scopeTriggerSource = source.slice(
      source.indexOf('content={searchScopePopoverContent}'),
      source.indexOf('{isV2Ui && (', source.indexOf('content={searchScopePopoverContent}')),
    );
    const objectFilterRenderSource = source.slice(
      source.indexOf('{isV2Ui && (', source.indexOf('content={searchScopePopoverContent}')),
      source.indexOf('{/* Toolbar */}', source.indexOf('{isV2Ui && (', source.indexOf('content={searchScopePopoverContent}'))),
    );

    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.all'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.tables'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.views'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.sequences'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.routines'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.packages'");
    expect(objectKindSource).toContain("labelKey: 'sidebar.command_search.object_kind.events'");
    expect(objectKindSource).not.toContain("label: '全部'");
    expect(objectKindSource).not.toContain("label: '表'");
    expect(objectKindSource).not.toContain("label: '视图'");
    expect(objectKindSource).not.toContain("label: '序列'");
    expect(objectKindSource).not.toContain("label: '函数'");
    expect(objectKindSource).not.toContain("label: '存储包'");
    expect(objectKindSource).not.toContain("label: '事件'");

    expect(searchScopeSource).toContain("labelKey: 'sidebar.command_search.scope.smart'");
    expect(searchScopeSource).toContain("labelKey: 'sidebar.command_search.scope.object'");
    expect(searchScopeSource).toContain("labelKey: 'sidebar.command_search.scope.database'");
    expect(searchScopeSource).toContain("labelKey: 'sidebar.command_search.scope.host'");
    expect(searchScopeSource).toContain("labelKey: 'sidebar.command_search.scope.tag'");
    expect(searchScopeSource).not.toContain("label: '智能'");
    expect(searchScopeSource).not.toContain("label: '表对象'");
    expect(searchScopeSource).not.toContain("label: '库'");
    expect(searchScopeSource).not.toContain("label: 'Host'");
    expect(searchScopeSource).not.toContain("label: '标签'");

    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.summary_smart')");
    expect(scopePanelSource).toContain('t(SEARCH_SCOPE_LABEL_KEY_MAP[scope])');
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.title')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.description')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.recommended')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.smart_help')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.manual_title')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.multi_select')");
    expect(scopePanelSource).toContain("t('sidebar.command_search.scope.manual_help')");
    expect(scopePanelSource).toContain('const currentLanguage = getCurrentLanguage();');
    expect(scopePanelSource).toContain('}, [searchScopes, currentLanguage]);');
    expect(scopePanelSource).toContain('}, [darkMode, overlayTheme, searchScopes, currentLanguage]);');
    expect(scopePanelSource).not.toContain('搜索范围');
    expect(scopePanelSource).not.toContain('“智能”自动匹配最可能的命中项；手动模式支持按维度组合筛选。');
    expect(scopePanelSource).not.toContain('推荐');
    expect(scopePanelSource).not.toContain('适合日常检索，自动覆盖名称、库、Host 和标签等高频维度。');
    expect(scopePanelSource).not.toContain('手动范围');
    expect(scopePanelSource).not.toContain('支持多选组合');
    expect(scopePanelSource).not.toContain('智能与其他项互斥。若你明确知道要搜的是对象、库、Host 或标签，建议切到手动范围以减少噪音结果。');

    expect(scopeTriggerSource).toContain("t('sidebar.command_search.scope.tooltip'");
    expect(scopeTriggerSource).toContain("t('sidebar.command_search.scope.compact_smart')");
    expect(scopeTriggerSource).not.toContain('搜索范围：');
    expect(scopeTriggerSource).not.toContain("? '智' : searchScopes.length");
    expect(objectFilterRenderSource).toContain("aria-label={t('sidebar.command_search.object_kind.filter_aria')}");
    expect(objectFilterRenderSource).toContain('t(item.labelKey)');
    expect(objectFilterRenderSource).not.toContain('aria-label="对象筛选"');

    const keys = [
      'sidebar.command_search.object_kind.all',
      'sidebar.command_search.object_kind.tables',
      'sidebar.command_search.object_kind.views',
      'sidebar.command_search.object_kind.sequences',
      'sidebar.command_search.object_kind.routines',
      'sidebar.command_search.object_kind.packages',
      'sidebar.command_search.object_kind.events',
      'sidebar.command_search.scope.smart',
      'sidebar.command_search.scope.object',
      'sidebar.command_search.scope.database',
      'sidebar.command_search.scope.host',
      'sidebar.command_search.scope.tag',
      'sidebar.command_search.scope.summary_smart',
      'sidebar.command_search.scope.title',
      'sidebar.command_search.scope.description',
      'sidebar.command_search.scope.recommended',
      'sidebar.command_search.scope.smart_help',
      'sidebar.command_search.scope.manual_title',
      'sidebar.command_search.scope.multi_select',
      'sidebar.command_search.scope.manual_help',
      'sidebar.command_search.scope.tooltip',
      'sidebar.command_search.scope.compact_smart',
      'sidebar.command_search.object_kind.filter_aria',
    ];

    SUPPORTED_LANGUAGES.forEach((language) => {
      setCurrentLanguage(language);
      keys.forEach((key) => {
        expect(t(key)).not.toBe(key);
      });
    });
  });

  it('localizes extracted sidebar util search and v2 filter labels through injected translators', () => {
    const translate = (key: string) => ({
      'sidebar.search.scope.smart': 'Smart',
      'sidebar.search.scope.object': 'Object',
      'sidebar.search.scope.database': 'Database',
      'sidebar.search.scope.host': 'Host',
      'sidebar.search.scope.tag': 'Tag',
      'sidebar.command_search.object_kind.all': 'All',
      'sidebar.command_search.object_kind.tables': 'Tables',
      'sidebar.command_search.object_kind.views': 'Views',
      'sidebar.command_search.object_kind.sequences': 'Sequences',
      'sidebar.command_search.object_kind.routines': 'Routines',
      'sidebar.command_search.object_kind.packages': 'Packages',
      'sidebar.command_search.object_kind.events': 'Events',
      'table_overview.section.pinned': 'Pinned',
      'table_overview.section.all': 'All',
    } as Record<string, string>)[key] || key;

    expect(buildCoreSearchScopeOptions(translate).map((option) => option.label)).toEqual(['Smart', 'Object', 'Database', 'Host', 'Tag']);
    expect(CORE_SEARCH_SCOPE_OPTIONS.map((option) => option.label)).toEqual([
      t('sidebar.search.scope.smart', undefined, 'zh-CN'),
      t('sidebar.search.scope.object', undefined, 'zh-CN'),
      t('sidebar.search.scope.database', undefined, 'zh-CN'),
      t('sidebar.search.scope.host', undefined, 'zh-CN'),
      t('sidebar.search.scope.tag', undefined, 'zh-CN'),
    ]);
    expect(buildV2ExplorerFilterOptions(translate).map((option) => option.label)).toEqual(['All', 'Tables', 'Views', 'Sequences', 'Routines', 'Packages', 'Events']);
    expect(V2_UTILS_EXPLORER_FILTER_OPTIONS.map((option) => option.label)).toEqual(['全部', '表', '视图', '序列', '函数', '存储包', '事件']);

    const tableNodes = [
      { title: 'orders', key: 'orders', type: 'table' as const, dataRef: { pinnedSidebarTable: true } },
      { title: 'users', key: 'users', type: 'table' as const, dataRef: { pinnedSidebarTable: false } },
    ];

    expect(buildV2UtilsSidebarTableSectionedChildren('conn-main-tables', tableNodes, translate).map((node) => node.title)).toEqual([
      'Pinned',
      'orders',
      'All',
      'users',
    ]);
    expect(buildV2UtilsSidebarTableChildrenForUi('conn-main-tables', tableNodes, true, translate).map((node) => node.title)).toEqual([
      'Pinned',
      'orders',
      'All',
      'users',
    ]);
  });

  it('keeps the v2 command search footer hints tied to real prefix actions', () => {
    const source = readSidebarSource();

    expect(source).toContain("const v2CommandSearchObjectMode = v2CommandSearchQuery.mode === 'object';");
    expect(source).toContain("const v2CommandSearchAiMode = v2CommandSearchQuery.mode === 'ai';");
    expect(source).toContain("key: 'action-ask-ai'");
    expect(source).toContain("window.dispatchEvent(new CustomEvent('gonavi:ai:inject-prompt'");
    expect(source).toContain("<TableOutlined /> <kbd>@</kbd>{t('sidebar.command_search.footer.object_only')}");
    expect(source).toContain("<RobotOutlined /> <kbd>?</kbd>{t('sidebar.command_search.footer.ask_ai')}");
    expect(source).not.toContain('提示 · 以「@」开头按表名搜索，以「?」开头让 AI 回答');
  });

  it('renders v2 command action shortcuts from the shared shortcut options', () => {
    const source = readSidebarSource();

    expect(source).toContain("shortcut: resolveShortcutDisplay(shortcutOptions, 'newQueryTab', activeShortcutPlatform)");
    expect(source).toContain("shortcut: resolveShortcutDisplay(shortcutOptions, 'newConnection', activeShortcutPlatform)");
    expect(source).toContain("shortcut: resolveShortcutDisplay(shortcutOptions, 'toggleAIPanel', activeShortcutPlatform)");
    expect(source).toContain("shortcut: resolveShortcutDisplay(shortcutOptions, 'toggleLogPanel', activeShortcutPlatform)");
    expect(source).not.toContain("shortcut: '⌘N'");
    expect(source).not.toContain("shortcut: '⌘⇧N'");
    expect(source).not.toContain("shortcut: '⌘J'");
    expect(source).not.toContain("shortcut: '⌘L'");
  });

  it('scales the v2 rail and keeps fixed workbench tools below a scrollable primary area', () => {
    const css = readV2ThemeCss();

    expect(css).toMatch(/\.gn-v2-rail-workbench-actions,\s*body\[data-ui-version="v2"\] \.gn-v2-rail-system-actions \{[^}]*flex-direction: column;/s);
    expect(css).toMatch(/\.gn-v2-rail-workbench-actions \{[^}]*border-bottom: 0\.5px solid var\(--gn-br-1\);/s);
    expect(css).toMatch(/\.gn-v2-rail-items \{[^}]*flex: 1 1 auto;[^}]*overflow-y: auto;/s);
    expect(css).toMatch(/\.gn-v2-rail-secondary-actions \{[^}]*margin-top: auto;[^}]*flex: 0 0 auto;/s);
    expect(css).toMatch(/\.gn-v2-explorer-toolbar\s*\{[^}]*display:\s*none\s*!important/s);
    expect(css).toMatch(/\.ant-tree \{[^}]*font-size: var\(--gn-sidebar-tree-font-size, var\(--gn-font-size-sm, 12px\)\);/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree \{[^}]*font-size: var\(--gn-sidebar-tree-font-size, var\(--gn-font-size-sm, 12px\)\);/s);
    expect(css).toMatch(/\.gn-v2-tree-title \{[^}]*font-size: var\(--gn-sidebar-tree-font-size, var\(--gn-font-size-sm, 12px\)\);/s);
    expect(css).toMatch(/\.gn-v2-tree-title\.is-mono \.gn-v2-tree-label \{[^}]*font-size: inherit;[^}]*font-weight: 400 !important;/s);
    expect(css).toMatch(/\.gn-v2-tree-count \{[^}]*font-size: clamp\(10px, calc\(var\(--gn-sidebar-tree-font-size, var\(--gn-font-size-sm, 12px\)\) - 1px\), 16px\);/s);
    expect(css).toMatch(/\.gn-v2-tree-title\.is-redis-db \.gn-v2-tree-label \{[^}]*display: inline-flex;[^}]*gap: 6px;/s);
    expect(css).toMatch(/\.gn-v2-redis-db-alias \{[^}]*color: var\(--gn-fg-5\);[^}]*opacity: 0\.78;/s);
    expect(css).toContain('--gn-v2-rail-scale: calc(var(--gn-ui-scale, 1) * var(--gn-sidebar-rail-scale, 1));');
    expect(css).toMatch(/\.gn-v2-connection-rail \{[^}]*width: calc\(38px \* var\(--gn-v2-rail-scale\)\);[^}]*flex: 0 0 calc\(38px \* var\(--gn-v2-rail-scale\)\);/s);
    expect(css).toMatch(/body\[data-ui-version="v2"\] \.gn-v2-rail-item,\s*body\[data-ui-version="v2"\] \.gn-v2-rail-tool \{[^}]*width: calc\(36px \* var\(--gn-v2-rail-scale\)\);[^}]*height: calc\(38px \* var\(--gn-v2-rail-scale\)\);[^}]*font-size: calc\(var\(--gn-font-size-sm, 12px\) \* var\(--gn-sidebar-rail-scale, 1\)\);/s);
    expect(css).toMatch(/\.gn-v2-rail-tool \{[^}]*height: calc\(32px \* var\(--gn-v2-rail-scale\)\);/s);
    expect(css).toMatch(/\.gn-v2-rail-tool \{[^}]*width: calc\(24px \* var\(--gn-v2-rail-scale\)\);/s);
    expect(css).toMatch(/\.gn-v2-active-connection-trigger \{[^}]*height: 34px;[^}]*border: 0;[^}]*background: transparent;/s);
    expect(css).toMatch(/\.gn-v2-active-connection-query-action \{[^}]*max-width: 96px;[^}]*font-size: 12px;/s);
    expect(css).toMatch(/\.gn-v2-active-connection-tooltip \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: 2px;[^}]*max-width: min\(320px, calc\(100vw - 24px\)\);[^}]*overflow-wrap: anywhere;/s);
    expect(css).toMatch(/\.gn-v2-object-explorer \{[^}]*container-type: inline-size;[^}]*container-name: gn-v2-object-explorer;/s);
    expect(css).toMatch(/@container gn-v2-object-explorer \(max-width: 440px\) \{[\s\S]*\.gn-v2-active-connection-query-action \{[^}]*width: 28px;[^}]*max-width: 28px;[^}]*padding: 0;/s);
    expect(css).toMatch(/@container gn-v2-object-explorer \(max-width: 440px\) \{[\s\S]*\.gn-v2-active-connection-query-action > span:not\(\.anticon\):not\(\.ant-btn-icon\) \{[^}]*display: none;/s);
    expect(css).not.toContain('.gn-v2-active-connection-trigger:hover');
  });

  it('opens the v2 header new-query action in the selected database before connection creation', () => {
    mocks.state.connections = [{
      id: 'conn-local',
      name: '开发240',
      config: {
        type: 'mysql',
        host: 'front_end_sys_dev',
        port: 3306,
      },
    }];
    mocks.state.activeContext = { connectionId: 'conn-local', dbName: 'front_end_sys_dev' };
    mocks.state.appearance = {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'v2',
      sidebarHiddenObjectGroups: [],
    };

    const markup = renderSidebarMarkup({ uiVersion: 'v2', onCreateConnection: mocks.noop });
    const sidebarSource = readSourceFile('./Sidebar.tsx');
    const headerSource = sidebarSource.slice(
      sidebarSource.indexOf('<div className="gn-v2-active-connection-actions">'),
      sidebarSource.indexOf('<Tooltip title={v2ConnectionActionsLabel}>', sidebarSource.indexOf('<div className="gn-v2-active-connection-actions">')),
    );
    const newQueryActionSource = headerSource.slice(
      headerSource.indexOf('<Tooltip title={t(\'sidebar.menu.new_query\')}>'),
      headerSource.indexOf('{onCreateConnection && ('),
    );

    expect(markup).toContain('data-gonavi-new-query-action="true"');
    expect(markup).toContain('aria-label="新建查询"');
    expect(markup).toContain('新建查询');
    expect(markup.indexOf('data-gonavi-new-query-action="true"')).toBeLessThan(markup.indexOf('data-gonavi-create-connection-action="true"'));
    expect(newQueryActionSource).toContain('icon={<FileTextOutlined />}');
    expect(newQueryActionSource).not.toContain('icon={<PlusOutlined />}');
    expect(newQueryActionSource).toContain('const selectedDatabase = resolveV2SelectedDatabaseName({');
    expect(newQueryActionSource).toContain('activeConnectionId: activeConnection.id,');
    expect(newQueryActionSource).toContain('activeContextConnectionId: activeContext?.connectionId,');
    expect(newQueryActionSource).toContain("handleV2DatabaseContextMenuAction(getDatabaseNodeRef(activeConnection, selectedDatabase), 'new-query');");
    expect(newQueryActionSource).toContain("handleV2ConnectionContextMenuAction(getConnectionNodeForAction(activeConnection), 'new-query');");
    expect(newQueryActionSource).toContain('disabled={!activeConnection}');
  });

  it('keeps v2 explorer filter tabs on a single line when Oracle object filters are present', () => {
    const css = readV2ThemeCss();

    expect(css).toMatch(/\.gn-v2-explorer-filter-tabs \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/s);
    expect(css).toMatch(/\.gn-v2-explorer-filter-tabs button \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/s);
  });

  it('shows a pending state while a database node is loading', () => {
    const css = readV2ThemeCss();
    const source = readSidebarSource();
    const treeLoaderSource = readSourceFile('./sidebar/useSidebarTreeLoaders.tsx');
    const titleRenderSource = readSourceFile('./sidebar/useSidebarTitleRender.tsx');

    expect(source).toContain("export type SidebarConnectionState = 'loading' | 'success' | 'error';");
    expect(treeLoaderSource).toContain("setConnectionStates(prev => ({ ...prev, [conn.id]: 'loading' }));");
    expect(treeLoaderSource).toContain("setConnectionStates(prev => ({ ...prev, [key as string]: 'loading' }));");
    expect(treeLoaderSource).toContain('let shouldMarkConnectionSuccess = false;');
    expect(treeLoaderSource).toContain('let shouldMarkDatabaseSuccess = false;');
    expect(treeLoaderSource).toContain('loadingNodesRef.current.delete(loadKey);');
    expect(treeLoaderSource).toContain('if (shouldMarkConnectionSuccess) {');
    expect(treeLoaderSource).toContain("setConnectionStates(prev => ({ ...prev, [conn.id]: 'success' }));");
    expect(treeLoaderSource).toContain('if (shouldMarkDatabaseSuccess) {');
    expect(treeLoaderSource).toContain("setConnectionStates(prev => ({ ...prev, [key as string]: 'success' }));");
    expect(titleRenderSource).toContain("let status: 'loading' | 'success' | 'error' | 'default' = 'default';");
    expect(titleRenderSource).toContain("if (connectionStates[node.key] === 'loading') status = 'loading';");
    expect(css).toMatch(/\.gn-v2-tree-status\.is-loading::before \{[^}]*border: 2px solid rgba\(37, 99, 235, 0\.24\);[^}]*animation: gn-v2-tree-status-spin 0\.8s linear infinite;/s);
    expect(css).toMatch(/@keyframes gn-v2-tree-status-spin \{[^}]*to \{ transform: rotate\(360deg\); \}/s);
  });

  it('keeps v2 tree status dots circular while using virtual horizontal scroll for long labels', () => {
    const css = readV2ThemeCss();
    const source = readSidebarSource();
    const utilsSource = readFileSync(new URL('./sidebarV2Utils.ts', import.meta.url), 'utf8');

    expect(source).toContain('gn-v2-tree-status is-${status}');
    expect(source).toContain('data-sidebar-tree-folder-icon="true"');
    expect(source).toContain("overflow: 'hidden'");
    expect(source).not.toContain("overflowX: isV2Ui ? 'auto' : 'hidden'");
    expect(source).toContain('scrollWidth={isV2Ui ? v2TreeHorizontalScrollWidth : undefined}');
    expect(utilsSource).toContain('export const V2_TREE_HORIZONTAL_SCROLL_BOTTOM_RESERVE = 32;');
    expect(source).toContain('const effectiveTreeHeight = treeHeight;');
    expect(source).not.toContain('treeHeight - V2_TREE_HORIZONTAL_SCROLL_BOTTOM_RESERVE');
    expect(source).toContain('height={effectiveTreeHeight}');
    expect(source).toContain('treeData={isV2Ui ? v2VisibleTreeData : displayTreeData}');
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \{[^}]*--gn-v2-tree-horizontal-scroll-reserve: 32px;[^}]*overflow: hidden !important;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.sidebar-tree-scroll-content \{[^}]*display: flex;[^}]*height: 100%;[^}]*padding: 4px 0 0;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree \{[^}]*flex: 1 1 auto;[^}]*width: 100%;[^}]*min-width: 0;[^}]*height: 100%;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list \{[^}]*position: relative;[^}]*height: 100%;[^}]*min-height: 0;[^}]*box-sizing: border-box;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder-inner \{[^}]*width: 100%;[^}]*min-width: 100%;/s);
    expect(css).not.toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder-inner \{[^}]*width: max-content;/s);
    expect(css).not.toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list \{[^}]*position: static !important;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder \{[^}]*height: calc\(100% - var\(--gn-v2-tree-horizontal-scroll-reserve\)\);[^}]*max-height: calc\(100% - var\(--gn-v2-tree-horizontal-scroll-reserve\)\) !important;/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder \{[^}]*overflow-x: hidden !important;/s);
    expect(css).not.toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder \{[^}]*overflow-x: auto !important;/s);
    expect(css).not.toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-holder \{[^}]*padding-bottom: var\(--gn-v2-tree-horizontal-scroll-reserve\);/s);
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-scrollbar-horizontal \{[^}]*height: 12px !important;[^}]*bottom: 0 !important;/s);
    expect(css).not.toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-scrollbar-horizontal \{[^}]*bottom: calc\(\(var\(--gn-v2-tree-horizontal-scroll-reserve\) - 12px\) \/ 2\) !important;/s);
    const horizontalScrollbarCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-list-scrollbar-horizontal');
    expect(horizontalScrollbarCss).toContain('border-radius: 999px !important;');
    expect(horizontalScrollbarCss).toContain('background: transparent !important;');
    expect(horizontalScrollbarCss).toContain('box-shadow: none !important;');
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-list-scrollbar-horizontal \.ant-tree-list-scrollbar-thumb \{[^}]*height: 8px !important;/s);
    const treeContentWrapperCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-node-content-wrapper');
    expect(treeContentWrapperCss).toContain('min-width: 100%;');
    expect(treeContentWrapperCss).toContain('width: max-content !important;');
    expect(treeContentWrapperCss).toContain('display: flex !important;');
    expect(css).toMatch(/\.gn-v2-tree-title\.is-connection \{[^}]*align-items:\s*center;/s);
    const antTreeTitleCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-title');
    expect(antTreeTitleCss).toContain('min-width: max-content;');
    expect(antTreeTitleCss).toContain('flex: 0 0 auto;');
    expect(antTreeTitleCss).toContain('overflow: visible;');
    const antTreeTitleSpanCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-title > span');
    expect(antTreeTitleSpanCss).toContain('min-width: max-content;');
    expect(antTreeTitleSpanCss).toContain('overflow: visible;');
    expect(antTreeTitleSpanCss).toContain('text-overflow: clip;');
    const v2TreeTitleCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-title > .gn-v2-tree-title');
    expect(v2TreeTitleCss).toContain('width: max-content;');
    expect(v2TreeTitleCss).toContain('min-width: 100%;');
    expect(v2TreeTitleCss).toContain('overflow: visible;');
    expect(css).toMatch(/\.gn-v2-tree-status \{[^}]*width: 14px;[^}]*height: 14px;[^}]*flex: 0 0 14px;[^}]*overflow: visible;/s);
    expect(css).toMatch(/\.gn-v2-tree-status::before \{[^}]*width: 9px;[^}]*height: 9px;[^}]*border: 1\.5px solid var\(--gn-fg-4\);[^}]*border-radius: 50%;/s);
    expect(css).toMatch(/\.gn-v2-tree-status\.is-success::before \{[^}]*border: 0;[^}]*background: var\(--gn-status-connected\);[^}]*box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--gn-status-connected\) 22%, transparent\);/s);
    const treeLabelCss = readCssRuleBlock(css, 'body[data-ui-version="v2"] .gn-v2-tree-label');
    expect(treeLabelCss).toContain('flex: 0 0 auto;');
    expect(treeLabelCss).toContain('overflow: visible;');
    expect(treeLabelCss).toContain('text-overflow: clip;');
    expect(css).toMatch(/\.gn-v2-tree-title\.is-mono \{[^}]*width: max-content;[^}]*min-width: 100%;[^}]*flex: 0 0 auto;/s);
    expect(css).toMatch(/\.gn-v2-tree-title\.is-mono \.gn-v2-tree-label \{[^}]*flex: 0 0 auto;[^}]*overflow: visible;[^}]*text-overflow: clip;/s);
    expect(css).toMatch(/\.gn-v2-tree-folder-icon \{[^}]*width: 22px;[^}]*height: 22px;[^}]*flex: 0 0 22px;/s);
    expect(css).not.toContain('.gn-v2-tree-connection-meta');
  });

  it('estimates a v2 tree scroll width only when content is wider than the viewport', () => {
    const narrowWidth = estimateV2TreeHorizontalScrollWidth([
      {
        title: 'front_end_sys',
        key: 'db-front-end',
        type: 'database',
        children: [{
          title: 'com_vod_error_file_tmp_with_a_very_long_table_name',
          key: 'table-long',
          type: 'table',
        }],
      },
    ] as any, 260);
    const wideWidth = estimateV2TreeHorizontalScrollWidth([
      {
        title: 'users',
        key: 'table-users',
        type: 'table',
      },
    ] as any, 900);
    const veryLongWidth = estimateV2TreeHorizontalScrollWidth([
      {
        title: `example.main.${'order_detail_with_long_business_suffix_'.repeat(6)}`,
        key: 'table-very-long',
        type: 'table',
      },
    ] as any, 320);

    expect(narrowWidth).toBeGreaterThan(260);
    expect(narrowWidth).toBeLessThanOrEqual(2600);
    expect(veryLongWidth).toBeGreaterThan(960);
    expect(veryLongWidth).toBeLessThanOrEqual(2600);
    expect(wideWidth).toBeUndefined();
  });

  it('includes table metadata suffixes when estimating v2 tree horizontal scroll width', () => {
    setCurrentLanguage('zh-CN');

    const tableNode = [{
      title: 'orders',
      key: 'table-orders',
      type: 'table',
      dataRef: {
        tableComment: '订单归档明细按月分区',
        rowCount: 2_450_000,
        tableSize: 157_286_400,
        createdAt: '2026-07-01 08:30:00',
        updatedAt: '2026-07-02 09:45:00',
      },
    }];
    const viewportWidth = 360;
    const titleOnlyWidth = estimateV2TreeHorizontalScrollWidth(tableNode as any, viewportWidth, []);
    const metadataWidth = estimateV2TreeHorizontalScrollWidth(
      tableNode as any,
      viewportWidth,
      ['comment', 'rows', 'size', 'createdAt', 'updatedAt'],
    );

    expect(titleOnlyWidth).toBeUndefined();
    expect(metadataWidth).toBeGreaterThan(viewportWidth);
    expect(metadataWidth).toBeGreaterThan(titleOnlyWidth ?? viewportWidth);
  });

  it('does not repeat the active connection as an object-tree root in v2', () => {
    mocks.state.connections = [{
      id: 'conn-local',
      name: '本地',
      config: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
      },
    }];
    mocks.state.activeContext = { connectionId: 'conn-local', dbName: 'app_db' };
    mocks.state.activeTabId = '';
    mocks.state.tabs = [];
    mocks.state.appearance = {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'v2',
      sidebarHiddenObjectGroups: [],
    };

    const markup = renderSidebarMarkup({ uiVersion: 'v2' });

    expect(markup).toContain('gn-v2-connection-rail');
    expect(markup).toContain('gn-v2-active-connection-copy');
    expect(markup).toMatch(/<strong aria-describedby="[^"]+">本地<\/strong>/);
    expect(markup).toMatch(/<span aria-describedby="[^"]+">app_db<\/span>/);
    expect(markup).not.toContain('title="本地"');
    expect(markup).not.toContain('title="app_db"');
    expect(markup).not.toContain('gn-v2-live-dot');
    expect(markup).not.toContain('<span>localhost</span>');
    expect(markup).not.toContain('gn-v2-db-icon-label');
  });

  it('shows an empty v2 active host header when no host is selected', () => {
    setCurrentLanguage('en-US');

    mocks.state.connections = [{
      id: 'conn-local',
      name: '本地',
      config: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
      },
    }];
    mocks.state.activeContext = null;
    mocks.state.activeTabId = '';
    mocks.state.tabs = [];
    mocks.state.appearance = {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'v2',
      sidebarHiddenObjectGroups: [],
    };

    const markup = renderSidebarMarkup({ uiVersion: 'v2' });

    expect(markup).toMatch(new RegExp(`<strong aria-describedby="[^"]+">${t('sidebar.active_connection.no_host_selected')}</strong>`));
    expect(markup).toMatch(new RegExp(`<span aria-describedby="[^"]+">${t('sidebar.active_connection.no_database_selected')}</span>`));
    expect(markup).not.toContain(`title="${t('sidebar.active_connection.no_host_selected')}"`);
    expect(markup).not.toContain(`title="${t('sidebar.active_connection.no_database_selected')}"`);
    expect(markup).not.toContain('<strong>本地</strong>');
  });

  it('keeps all filter backed by the full tree so hosts remain visible in v2', () => {
    mocks.state.connections = [
      {
        id: 'dev240',
        name: 'dev240',
        config: {
          type: 'mysql',
          host: '10.0.0.240',
          port: 3306,
        },
      },
      {
        id: 'local',
        name: '本地',
        config: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
        },
      },
    ];
    mocks.state.connectionTags = [{
      id: 'prod',
      name: '生产环境',
      connectionIds: ['dev240'],
    }];
    mocks.state.activeContext = { connectionId: 'dev240', dbName: '' };
    mocks.state.activeTabId = '';
    mocks.state.tabs = [];
    mocks.state.appearance = {
      enabled: true,
      opacity: 1,
      blur: 0,
      uiVersion: 'v2',
      sidebarHiddenObjectGroups: [],
    };

    const markup = renderSidebarMarkup({ uiVersion: 'v2' });
    const source = readSidebarSource();

    expect(source).toContain("if (v2ExplorerFilter === 'all') {");
    expect(source).toContain('return displayTreeData;');
    expect(source).toContain('gn-v2-tree-connection-copy');
    expect(source).not.toContain('gn-v2-tree-connection-meta');
  });

  it('remounts the v2 tree when object filters change to avoid rc-tree node reuse drift', () => {
    const source = readSidebarSource();

    expect(source).toContain("key={isV2Ui ? `v2-tree-${v2ExplorerFilter}` : 'legacy-tree'}");
    expect(source).toContain('treeData={isV2Ui ? v2VisibleTreeData : displayTreeData}');
  });

  it('uses the hierarchy actions for mixed sibling host and subgroup drag ordering', () => {
    const source = readSidebarSource();
    const utilsSource = readFileSync(new URL('./sidebarV2Utils.ts', import.meta.url), 'utf8');

    expect(source).toContain('const moveConnectionTag = useStore(state => state.moveConnectionTag);');
    expect(source).toContain('moveConnectionTag(dragTagId, targetParentTagId, targetToken, targetInsertBefore);');
    expect(source).toContain('moveConnectionToTag(connectionId, targetParentTagId, targetToken, targetInsertBefore);');
    expect(source).toContain('const insertBefore = resolveSidebarDropInsertBefore(');
    expect(source).toContain('const domDropNode = resolveSidebarDropNodeFromDomEvent(info?.event);');
    expect(source).toContain('const dropTargetMetrics = resolveSidebarDropTargetMetricsFromDomEvent(info?.event);');
    expect(source).toContain("findTreeNodeByKeyRef.current(treeDataRef.current, domDropNode.key)");
    expect(utilsSource).toContain("const treeNode = baseElement.closest('.ant-tree-treenode') as HTMLElement | null;");
    expect(source).toContain("info?.dropToGap === false");
  });

  it('rejects a drag path that would put a group into itself or one of its descendants', () => {
    const source = readSidebarSource();

    expect(source).toContain('const allowSidebarTreeDrop = ({ dragNode, dropNode, dropPosition }: any): boolean => {');
    expect(source).toContain('!isConnectionTagDescendant(dragTagId, targetParentTagId, connectionTags)');
    expect(source).toContain('allowDrop={allowSidebarTreeDrop}');
  });

  it('keeps selection preservation while routing tree drag through the shared hierarchy path', () => {
    const source = readSidebarSource();

    expect(source).toContain('const treeDragSelectSuppressUntilRef = useRef(0);');
    expect(source).toContain('const treeDragSelectionSnapshotRef = useRef<');
    expect(source).toContain('snapshotTreeSelectionBeforeDrag();');
    expect(source).toContain('restoreTreeSelectionAfterDrag();');
    expect(source).toContain('if (Date.now() < treeDragSelectSuppressUntilRef.current) {');
    expect(source).toContain('const getNodeOrderToken = (node: any): string | null => {');
    expect(source).toContain('const targetParentTagId = droppingIntoTag');
    expect(source).toContain('const targetToken = droppingIntoTag ? null : getNodeOrderToken(dropNode);');
    expect(source).toContain('onDrop={handleDrop}');
  });

  it('normalizes rc-tree absolute drop positions back to relative positions', () => {
    expect(normalizeSidebarTreeRelativeDropPosition(4, '0-0-4')).toBe(0);
    expect(normalizeSidebarTreeRelativeDropPosition(3, '0-0-4')).toBe(-1);
    expect(normalizeSidebarTreeRelativeDropPosition(5, '0-0-4')).toBe(1);
  });

  it('resolves insert-before from either relative drop position or pointer position', () => {
    expect(resolveSidebarDropInsertBefore(-1, null)).toBe(true);
    expect(resolveSidebarDropInsertBefore(1, null)).toBe(false);
    expect(resolveSidebarDropInsertBefore(0, {
      clientY: 102,
      top: 100,
      height: 20,
    })).toBe(true);
    expect(resolveSidebarDropInsertBefore(0, {
      clientY: 118,
      top: 100,
      height: 20,
    })).toBe(false);
  });

  it('resolves sidebar drop node metadata from DOM markers', () => {
    vi.stubGlobal('document', {
      elementFromPoint: () => null,
    });
    const marker = {
      getAttribute: (name: string) => {
        if (name === 'data-sidebar-node-key') return 'conn-a';
        if (name === 'data-sidebar-node-type') return 'connection';
        return null;
      },
    };
    const target = {
      closest: (selector: string) => selector === '[data-sidebar-node-key]' ? marker : null,
    };

    expect(resolveSidebarDropNodeFromDomEvent({
      target: target as unknown as EventTarget,
    })).toEqual({
      key: 'conn-a',
      type: 'connection',
    });
    vi.unstubAllGlobals();
  });

  it('resolves sidebar drop target metrics from the full tree row instead of nested children', () => {
    vi.stubGlobal('document', {
      elementFromPoint: () => null,
    });
    const treeNode = {
      getBoundingClientRect: () => ({
        top: 128,
        height: 26,
      }),
    };
    const target = {
      closest: (selector: string) => {
        if (selector === '.ant-tree-treenode') return treeNode;
        return null;
      },
    };

    expect(resolveSidebarDropTargetMetricsFromDomEvent({
      target: target as unknown as EventTarget,
    })).toEqual({
      top: 128,
      height: 26,
    });
    vi.unstubAllGlobals();
  });

  it('treats centered tag drops as directional reordering instead of no-op', () => {
    expect(resolveSidebarTagDropInsertBefore({
      currentTagOrder: ['tag-dev', 'tag-test', 'tag-prod'],
      dragTagId: 'tag-prod',
      dropTagId: 'tag-dev',
      relativeDropPosition: 0,
      fallbackInsertBefore: false,
      metrics: {
        clientY: 113,
        top: 100,
        height: 26,
      },
    })).toBe(true);

    expect(resolveSidebarTagDropInsertBefore({
      currentTagOrder: ['tag-dev', 'tag-test', 'tag-prod'],
      dragTagId: 'tag-dev',
      dropTagId: 'tag-prod',
      relativeDropPosition: 0,
      fallbackInsertBefore: true,
      metrics: {
        clientY: 113,
        top: 100,
        height: 26,
      },
    })).toBe(false);
  });

  it('skips sidebar select side effects while tree dragging is active', () => {
    expect(shouldSkipSidebarSelectWhileDragging(true, { selected: true })).toBe(true);
    expect(shouldSkipSidebarSelectWhileDragging(false, { selected: false })).toBe(true);
    expect(shouldSkipSidebarSelectWhileDragging(false, { selected: true })).toBe(false);
  });

  it('skips sidebar lazy load on expand while tree dragging is active', () => {
    expect(shouldSkipSidebarLoadOnExpandWhileDragging(true, {
      expanded: true,
      node: { type: 'connection', children: undefined, isLeaf: false } as any,
    })).toBe(true);
    expect(shouldSkipSidebarLoadOnExpandWhileDragging(false, {
      expanded: false,
      node: { type: 'connection', children: undefined, isLeaf: false } as any,
    })).toBe(true);
    expect(shouldSkipSidebarLoadOnExpandWhileDragging(false, {
      expanded: true,
      node: { type: 'connection', children: undefined, isLeaf: false } as any,
    })).toBe(false);
  });

  it('renders the v2 connection group context menu for rail group management', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2ConnectionGroupContextMenuView
        groupName="生产环境"
        count={2}
      />,
    );

    expect(markup).toContain('data-v2-connection-group-context-menu="true"');
    expect(markup).toContain('生产环境');
    expect(markup).toContain(t('connection.sidebar.group.meta', { count: '2' }));
    expect(markup).toContain(t('connection.sidebar.group.badge'));
    expect(markup).toContain(t('connection.sidebar.group.edit'));
    expect(markup).toContain(t('connection.sidebar.group.delete'));
  });

  it('filters the v2 explorer tree by object kind tabs', () => {
    const tree = [{
      title: 'front_end_sys',
      key: 'conn-main',
      type: 'database' as const,
      children: [
        {
          title: '已存查询 · saved',
          key: 'conn-main-queries',
          type: 'queries-folder' as const,
          children: [{ title: '日常查询', key: 'query-1', type: 'saved-query' as const }],
        },
        {
          title: '表',
          key: 'conn-main-tables',
          type: 'object-group' as const,
          dataRef: { groupKey: 'tables' },
          children: [{ title: 'users', key: 'users', type: 'table' as const }],
        },
        {
          title: '视图',
          key: 'conn-main-views',
          type: 'object-group' as const,
          dataRef: { groupKey: 'views' },
          children: [{ title: 'v_users', key: 'v_users', type: 'view' as const }],
        },
        {
          title: '序列',
          key: 'conn-main-sequences',
          type: 'object-group' as const,
          dataRef: { groupKey: 'sequences' },
          children: [{ title: 'seq_person_id', key: 'seq_person_id', type: 'sequence' as const }],
        },
        {
          title: '函数',
          key: 'conn-main-routines',
          type: 'object-group' as const,
          dataRef: { groupKey: 'routines' },
          children: [{ title: 'calc_total', key: 'calc_total', type: 'routine' as const }],
        },
        {
          title: '存储包',
          key: 'conn-main-packages',
          type: 'object-group' as const,
          dataRef: { groupKey: 'packages' },
          children: [{ title: 'pkg_person', key: 'pkg_person', type: 'package' as const }],
        },
        {
          title: '事件',
          key: 'conn-main-events',
          type: 'object-group' as const,
          dataRef: { groupKey: 'events' },
          children: [{ title: 'daily_cleanup', key: 'daily_cleanup', type: 'db-event' as const }],
        },
      ],
    }];

    expect(filterV2ExplorerTreeByKind(tree, 'all')[0].children?.map((node: { key: string }) => node.key)).toEqual([
      'conn-main-queries',
      'conn-main-tables',
      'conn-main-views',
      'conn-main-sequences',
      'conn-main-routines',
      'conn-main-packages',
      'conn-main-events',
    ]);
    expect(filterV2ExplorerTreeByKind(tree, 'tables')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-tables']);
    expect(filterV2ExplorerTreeByKind(tree, 'views')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-views']);
    expect(filterV2ExplorerTreeByKind(tree, 'sequences')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-sequences']);
    expect(filterV2ExplorerTreeByKind(tree, 'routines')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-routines']);
    expect(filterV2ExplorerTreeByKind(tree, 'packages')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-packages']);
    expect(filterV2ExplorerTreeByKind(tree, 'events')[0].children?.map((node: { key: string }) => node.key)).toEqual(['conn-main-events']);
  });

  it('hides external SQL roots from v2 object kind filters', () => {
    const tree = [
      {
        title: 'front_end_sys',
        key: 'conn-main',
        type: 'database' as const,
        children: [
          {
            title: '表',
            key: 'conn-main-tables',
            type: 'object-group' as const,
            dataRef: { groupKey: 'tables' },
            children: [{ title: 'users', key: 'users', type: 'table' as const }],
          },
        ],
      },
      {
        title: '外部 SQL 目录',
        key: 'external-sql-root',
        type: 'external-sql-root' as const,
        children: [
          {
            title: 'scripts',
            key: 'external-sql-folder:scripts',
            type: 'external-sql-folder' as const,
          },
        ],
      },
    ];

    expect(filterV2ExplorerTreeByKind(tree, 'all').map((node: { key: string }) => node.key)).toEqual([
      'conn-main',
      'external-sql-root',
    ]);
    expect(filterV2ExplorerTreeByKind(tree, 'tables').map((node: { key: string }) => node.key)).toEqual(['conn-main']);
  });

  it('adds rename to the saved query context menu', () => {
    const source = readSidebarSource();
    const renameHandlerStart = source.indexOf('const handleRenameSavedQuery = async () =>');
    const renameHandlerEnd = source.indexOf('const openRoutineDefinition', renameHandlerStart);
    const savedQueryMenuStart = source.indexOf('// 已存查询节点的右键菜单');
    const savedQueryMenuEnd = source.indexOf("if (node.type === 'external-sql-root') {", savedQueryMenuStart);
    const renameModalOpenIndex = source.indexOf('open={isRenameSavedQueryModalOpen}');
    const renameModalStart = source.lastIndexOf('<Modal', renameModalOpenIndex);
    const renameModalEnd = source.indexOf('</Modal>', renameModalOpenIndex) + '</Modal>'.length;
    const renameHandlerSource = source.slice(renameHandlerStart, renameHandlerEnd);
    const savedQueryMenuSource = source.slice(savedQueryMenuStart, savedQueryMenuEnd);
    const renameModalSource = source.slice(renameModalStart, renameModalEnd);

    expect(renameHandlerStart).toBeGreaterThanOrEqual(0);
    expect(renameHandlerEnd).toBeGreaterThan(renameHandlerStart);
    expect(savedQueryMenuStart).toBeGreaterThanOrEqual(0);
    expect(savedQueryMenuEnd).toBeGreaterThan(savedQueryMenuStart);
    expect(renameModalStart).toBeGreaterThanOrEqual(0);
    expect(renameModalEnd).toBeGreaterThan(renameModalStart);

    expect(source).toContain('const openRenameSavedQueryModal = (query: SavedQuery) =>');
    expect(source).toContain('const resolveSavedQueryDisplayName = (name: string | null | undefined) =>');
    expect(savedQueryMenuSource).toContain('title: resolveSavedQueryDisplayName(q.name)');
    expect(renameHandlerSource).toContain("message.error(t('query_editor.save_modal.name_required'))");
    expect(renameHandlerSource).toContain("message.warning(t('sidebar.message.saved_query_name_unchanged'))");
    expect(renameHandlerSource).toContain("message.success(t('sidebar.message.saved_query_renamed'))");
    expect(renameHandlerSource).toContain("typeof backendApp?.RenameSavedQuery === 'function'");
    expect(renameHandlerSource).toContain('backendApp.RenameSavedQuery(renameSavedQueryTarget.id, nextName)');
    expect(renameHandlerSource).toContain('latestState.replaceSavedQueries(latestState.savedQueries.map');
    expect(renameHandlerSource).toContain('persisted = await saveQuery({');
    expect(savedQueryMenuSource).toContain("key: 'rename-query'");
    expect(savedQueryMenuSource).toContain("label: t('sidebar.menu.rename_query')");
    expect(savedQueryMenuSource).toContain("label: t('sidebar.menu.open_query')");
    expect(savedQueryMenuSource).toContain("label: t('sidebar.menu.delete_query')");
    expect(savedQueryMenuSource).toContain("title: t('sidebar.modal.confirm_delete.title')");
    expect(savedQueryMenuSource).toContain("content: t('sidebar.modal.confirm_delete_saved_query.content', { name: resolveSavedQueryDisplayName(q.name) })");
    expect(savedQueryMenuSource).toContain('onClick: () => openRenameSavedQueryModal(q)');
    expect(source).toContain('const handleRenameSavedQuery = async () =>');
    expect(renameModalSource).toContain("title={`${t('query_editor.save_modal.rename_title')}${renameSavedQueryTarget?.name ? ` (${renameSavedQueryTarget.name})` : ''}`}");
    expect(renameModalSource).toContain("okText={t('query_editor.action.rename_query')}");
    expect(renameModalSource).toContain("cancelText={t('common.cancel')}");
    expect(renameModalSource).toContain("label={t('query_editor.save_modal.name_label')}");
    expect(renameModalSource).toContain("message: t('query_editor.save_modal.name_required')");
    expect(savedQueryMenuSource).not.toContain("label: '打开查询'");
    expect(savedQueryMenuSource).not.toContain("label: '重命名查询'");
    expect(savedQueryMenuSource).not.toContain("label: '删除查询'");
    expect(savedQueryMenuSource).not.toContain("title: '确认删除'");
    expect(savedQueryMenuSource).not.toContain('content: `确定要删除已保存的查询 "${resolveSavedQueryDisplayName(q.name)}" 吗？此操作不可恢复。`');
    expect(renameHandlerSource).not.toContain("message.error('查询名称不能为空')");
    expect(renameHandlerSource).not.toContain("message.warning('新旧查询名称相同，无需修改')");
    expect(renameHandlerSource).not.toContain("message.success('查询已重命名')");
    expect(renameModalSource).not.toContain('title={`重命名查询${renameSavedQueryTarget?.name ? ` (${renameSavedQueryTarget.name})` : \'\'}`}');
    expect(renameModalSource).not.toContain('okText="重命名"');
    expect(renameModalSource).not.toContain('cancelText="取消"');
    expect(renameModalSource).not.toContain('label="查询名称"');
    expect(renameModalSource).not.toContain("message: '请输入查询名称'");
  });

  it('reveals a saved query file from its context menu', () => {
    const source = readSidebarSource();
    const handlerStart = source.indexOf('const handleRevealSavedQueryInFolder = useCallback(async (query: SavedQuery) =>');
    const handlerEnd = source.indexOf('const isSavedQueryUnmatched', handlerStart);
    const savedQueryMenuStart = source.indexOf('// \u5df2\u5b58\u67e5\u8be2\u8282\u70b9\u7684\u53f3\u952e\u83dc\u5355');
    const savedQueryMenuEnd = source.indexOf("if (node.type === 'external-sql-root') {", savedQueryMenuStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);
    const savedQueryMenuSource = source.slice(savedQueryMenuStart, savedQueryMenuEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain('await RevealSavedQueryInFolder(query.id)');
    expect(handlerSource).toContain("t('sidebar.message.saved_query_revealed')");
    expect(handlerSource).toContain("t('sidebar.message.saved_query_reveal_failed'");
    expect(savedQueryMenuSource).toContain("key: 'reveal-saved-query-in-folder'");
    expect(savedQueryMenuSource).toContain("label: t('sidebar.menu.reveal_saved_query_in_folder')");
    expect(savedQueryMenuSource).toContain('onClick: () => void handleRevealSavedQueryInFolder(q)');
  });

  it('renders the v2 table context menu with the redesigned table layout', () => {
    const markup = renderToStaticMarkup(
      <V2TableContextMenuView
        tableName="fs_mkefu_server_info"
        stats={{
          rowCount: 2,
          dataLength: 16 * 1024,
          indexLength: 16 * 1024,
          engine: 'InnoDB',
        }}
        supportsTruncate
      />,
    );

    expect(markup).toContain('data-v2-table-context-menu="true"');
    expect(markup).toContain('fs_mkefu_server_info');
    expect(markup).toContain('InnoDB');
    expect(markup).toContain('2 行 · 16 KB 数据 · 16 KB 索引');
    expect(markup).toContain('查看数据');
    expect(markup).toContain('↵');
    expect(markup).toContain('置顶表');
    expect(markup).toContain('字段 / 索引 / 外键');
    expect(markup).toContain('在新标签打开');
    expect(markup).toContain('Ctrl+Enter');
    expect(markup).toContain('元信息');
    expect(markup).toContain('查看 DDL · CREATE TABLE');
    expect(markup).toContain('在 ER 图中查看');
    expect(markup).toContain('复制');
    expect(markup).toContain('复制表名');
    expect(markup).toContain('复制表结构 · DDL');
    expect(markup).toContain('复制全表为 INSERT');
    expect(markup).toContain('维护');
    expect(markup).toContain('重命名…');
    expect(markup).toContain('备份 · SQL Dump');
    expect(markup).toContain('刷新统计信息');
    expect(markup).toContain('导出表数据');
    expect(markup).toContain('打开导出工作台…');
    expect(markup).not.toContain('Excel · .xlsx');
    expect(markup).not.toContain('CSV · .csv');
    expect(markup).not.toContain('JSON · .json');
    expect(markup).not.toContain('Markdown · .md');
    expect(markup).not.toContain('HTML · .html');
    expect(markup).toContain('用 AI 解释这张表');
    expect(markup).toContain('用 AI 生成查询');
    expect(markup).toContain('截断表 · TRUNCATE');
    expect(markup).toContain('删除表 · DROP');
    expect(markup).not.toContain('清空表');
  });

  it('renders the v2 table context menu pinned state', () => {
    const markup = renderToStaticMarkup(
      <V2TableContextMenuView
        tableName="fs_mkefu_server_info"
        isPinned
      />,
    );

    expect(markup).toContain('取消置顶');
    expect(markup).toContain('已置顶');
    expect(markup).not.toContain('置顶表');
  });

  it('keeps the v2 table context menu pin action localized via sidebar i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const pinActionSourceStart = source.indexOf("{ action: isPinned ? 'unpin-table' : 'pin-table'");
    const pinActionSourceEnd = source.indexOf("{ action: 'design-table'", pinActionSourceStart);
    const pinActionSource = source.slice(pinActionSourceStart, pinActionSourceEnd);

    expect(pinActionSourceStart).toBeGreaterThanOrEqual(0);
    expect(pinActionSourceEnd).toBeGreaterThan(pinActionSourceStart);
    expect(pinActionSource).toContain("t('sidebar.action.unpin_table')");
    expect(pinActionSource).toContain("t('sidebar.action.pin_table')");
    expect(pinActionSource).toContain("t('sidebar.status.pinned')");
    expect(pinActionSource).not.toContain('取消置顶');
    expect(pinActionSource).not.toContain('置顶表');
    expect(pinActionSource).not.toContain('已置顶');
  });

  it('localizes only the v2 table context menu primary actions via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const primaryActionSourceStart = source.indexOf("{ action: 'open-data'");
    const primaryActionSourceEnd = source.indexOf('])}', primaryActionSourceStart);
    const primaryActionSource = source.slice(primaryActionSourceStart, primaryActionSourceEnd);

    expect(primaryActionSourceStart).toBeGreaterThanOrEqual(0);
    expect(primaryActionSourceEnd).toBeGreaterThan(primaryActionSourceStart);
    expect(primaryActionSource).toContain("t('sidebar.v2_table_menu.open_data')");
    expect(primaryActionSource).toContain("t('sidebar.action.pin_table')");
    expect(primaryActionSource).toContain("t('sidebar.action.unpin_table')");
    expect(primaryActionSource).toContain("t('sidebar.status.pinned')");
    expect(primaryActionSource).toContain("t('sidebar.menu.design_table')");
    expect(primaryActionSource).toContain("t('sidebar.v2_table_menu.design_table_detail')");
    expect(primaryActionSource).toContain("t('sidebar.v2_table_menu.open_in_new_tab')");
    expect(primaryActionSource).toContain("t('sidebar.menu.new_query')");
    expect(primaryActionSource).not.toContain('查看数据');
    expect(primaryActionSource).not.toContain('设计表 · 字段 / 索引 / 外键');
    expect(primaryActionSource).not.toContain('在新标签打开');
  });

  it('localizes only the v2 table context menu metadata block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const metadataSourceStart = source.indexOf(`{t('sidebar.v2_table_menu.metadata_section')}`);
    const metadataSourceEnd = source.indexOf("{ action: 'copy-table-name'", metadataSourceStart);
    const metadataSource = source.slice(metadataSourceStart, metadataSourceEnd);

    expect(metadataSourceStart).toBeGreaterThanOrEqual(0);
    expect(metadataSourceEnd).toBeGreaterThan(metadataSourceStart);
    expect(metadataSource).toContain("t('sidebar.v2_table_menu.metadata_section')");
    expect(metadataSource).toContain("t('data_grid.ddl.view')");
    expect(metadataSource).toContain('CREATE TABLE');
    expect(metadataSource).toContain("t('sidebar.v2_table_menu.view_in_er')");
    expect(metadataSource).not.toContain('元信息');
    expect(metadataSource).not.toContain('查看 DDL · CREATE TABLE');
    expect(metadataSource).not.toContain('在 ER 图中查看');
    expect(metadataSource).not.toContain('复制表名');
  });

  it('localizes only the v2 table context menu copy block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const copySourceStart = source.indexOf(`{t('sidebar.v2_table_menu.copy_section')}`);
    const copySourceEnd = source.indexOf('{renderItems(maintenanceItems)}', copySourceStart);
    const copySource = source.slice(copySourceStart, copySourceEnd);

    expect(copySourceStart).toBeGreaterThanOrEqual(0);
    expect(copySourceEnd).toBeGreaterThan(copySourceStart);
    expect(copySource).toContain("t('sidebar.v2_table_menu.copy_section')");
    expect(copySource).toContain("t('sidebar.v2_table_menu.copy_table_name')");
    expect(copySource).toContain("t('sidebar.menu.copy_table_structure')");
    expect(copySource).toContain('DDL');
    expect(copySource).toContain("t('sidebar.v2_table_menu.copy_table_as_insert', { keyword: 'INSERT' })");
    expect(copySource).toContain('INSERT');
    expect(copySource).not.toContain('复制表名');
    expect(copySource).not.toContain('复制表结构 · DDL');
    expect(copySource).not.toContain('复制全表为 INSERT');
    expect(copySource).not.toContain('重命名…');
  });

  it('localizes only the v2 table context menu maintenance block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const maintenanceItemsSourceStart = source.indexOf('const maintenanceItems: V2TableContextMenuItemConfig[] = [');
    const maintenanceItemsSourceEnd = source.indexOf('const dangerItems: V2TableContextMenuItemConfig[] = [', maintenanceItemsSourceStart);
    const maintenanceItemsSource = source.slice(maintenanceItemsSourceStart, maintenanceItemsSourceEnd);
    const maintenanceRenderSourceStart = source.indexOf(`{t('sidebar.v2_table_menu.maintenance_section')}`);
    const maintenanceRenderSourceEnd = source.indexOf('{renderItems(maintenanceItems)}', maintenanceRenderSourceStart) + '{renderItems(maintenanceItems)}'.length;
    const maintenanceRenderSource = source.slice(maintenanceRenderSourceStart, maintenanceRenderSourceEnd);

    expect(maintenanceItemsSourceStart).toBeGreaterThanOrEqual(0);
    expect(maintenanceItemsSourceEnd).toBeGreaterThan(maintenanceItemsSourceStart);
    expect(maintenanceRenderSourceStart).toBeGreaterThanOrEqual(0);
    expect(maintenanceRenderSourceEnd).toBeGreaterThan(maintenanceRenderSourceStart);
    expect(maintenanceItemsSource).toContain("t('sidebar.v2_table_menu.rename_compact')");
    expect(maintenanceItemsSource).toContain("t('sidebar.v2_table_menu.new_rollup', { keyword: 'Rollup' })");
    expect(maintenanceItemsSource).toContain("t('sidebar.v2_table_menu.backup_sql_dump', { keyword: 'SQL Dump' })");
    expect(maintenanceItemsSource).toContain("t('sidebar.v2_table_menu.refresh_stats')");
    expect(maintenanceItemsSource).toContain('Rollup');
    expect(maintenanceItemsSource).toContain('SQL Dump');
    expect(maintenanceItemsSource).not.toContain('重命名…');
    expect(maintenanceItemsSource).not.toContain('新增 Rollup');
    expect(maintenanceItemsSource).not.toContain('备份 · SQL Dump');
    expect(maintenanceItemsSource).not.toContain('刷新统计信息');
    expect(maintenanceItemsSource).not.toContain('截断表 · TRUNCATE');
    expect(maintenanceItemsSource).not.toContain('导出表数据');
    expect(maintenanceRenderSource).toContain("t('sidebar.v2_table_menu.maintenance_section')");
    expect(maintenanceRenderSource).toContain('{renderItems(maintenanceItems)}');
    expect(maintenanceRenderSource).not.toContain('维护');
    expect(maintenanceRenderSource).not.toContain("t('sidebar.menu.export_table_data')");
    expect(maintenanceRenderSource).not.toContain('{renderItems(dangerItems)}');
  });

  it('localizes only the v2 table context menu export block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const exportSourceStart = source.indexOf(`{t('sidebar.menu.export_table_data')}`);
    const exportSourceEnd = source.indexOf('<div className="gn-v2-context-menu-divider" />', exportSourceStart);
    const exportSource = source.slice(exportSourceStart, exportSourceEnd);

    expect(exportSourceStart).toBeGreaterThanOrEqual(0);
    expect(exportSourceEnd).toBeGreaterThan(exportSourceStart);
    expect(exportSource).toContain("t('sidebar.menu.export_table_data')");
    expect(exportSource).toContain("t('sidebar.v2_table_menu.open_export_workbench')");
    expect(exportSource).toContain("{ action: 'export-data'");
    expect(exportSource).not.toContain('导出表数据');
    expect(exportSource).not.toContain("'打开导出工作台…'");
    expect(exportSource).not.toContain('用 AI 解释这张表');
  });

  it('localizes only the v2 table context menu ai block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const aiSourceStart = source.indexOf("{ action: 'ai-explain'");
    const aiSourceEnd = source.indexOf('<div className="gn-v2-context-menu-divider" />', aiSourceStart);
    const aiSource = source.slice(aiSourceStart, aiSourceEnd);

    expect(aiSourceStart).toBeGreaterThanOrEqual(0);
    expect(aiSourceEnd).toBeGreaterThan(aiSourceStart);
    expect(aiSource).toContain("t('sidebar.v2_table_menu.ai_explain_table')");
    expect(aiSource).toContain("t('sidebar.v2_table_menu.ai_generate_query')");
    expect(aiSource).not.toContain('用 AI 解释这张表');
    expect(aiSource).not.toContain('用 AI 生成查询');
    expect(aiSource).not.toContain('截断表 · TRUNCATE');
  });

  it('localizes only the v2 table context menu danger block via focused i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const dangerSourceStart = source.indexOf('const dangerItems: V2TableContextMenuItemConfig[] = [');
    const dangerSourceEnd = source.indexOf('return (', dangerSourceStart);
    const dangerSource = source.slice(dangerSourceStart, dangerSourceEnd);

    expect(dangerSourceStart).toBeGreaterThanOrEqual(0);
    expect(dangerSourceEnd).toBeGreaterThan(dangerSourceStart);
    expect(dangerSource).toContain("t('sidebar.v2_table_menu.item_with_suffix', {");
    expect(dangerSource).toContain("label: t('sidebar.v2_table_menu.truncate_table')");
    expect(dangerSource).toContain("label: t('sidebar.menu.delete_table')");
    expect(dangerSource).toContain("suffix: 'TRUNCATE'");
    expect(dangerSource).toContain("suffix: 'DROP'");
    expect(dangerSource).toContain('TRUNCATE');
    expect(dangerSource).toContain('DROP');
    expect(dangerSource).not.toContain('截断表 · TRUNCATE');
    expect(dangerSource).not.toContain('删除表 · DROP');
    expect(dangerSource).not.toContain('导出表数据');
  });

  it('localizes the v2 table context menu stats meta shell via dedicated i18n keys', () => {
    const source = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const metaSourceStart = source.indexOf('export const formatV2TableContextMenuRows =');
    const metaSourceEnd = source.indexOf('const V2TableContextMenuItem: React.FC<{', metaSourceStart);
    const metaSource = source.slice(metaSourceStart, metaSourceEnd);

    expect(metaSourceStart).toBeGreaterThanOrEqual(0);
    expect(metaSourceEnd).toBeGreaterThan(metaSourceStart);
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.rows_empty')");
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.rows'");
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.idle')");
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.loading')");
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.unavailable')");
    expect(metaSource).toContain("t('sidebar.v2_table_menu.meta.summary'");
    expect(metaSource).not.toContain('点击刷新统计信息读取');
    expect(metaSource).not.toContain('正在读取统计信息');
    expect(metaSource).not.toContain('统计信息不可用');
    expect(metaSource).not.toContain(' 数据 ');
    expect(metaSource).not.toContain(' 索引');
    expect(metaSource).not.toContain('— 行');
  });

  it('sorts pinned sidebar tables before the active sort mode', () => {
    const pinnedSidebarTables = [
      buildSidebarTablePinKey('conn-1', 'main', 'orders', 'public'),
    ];
    const entries = [
      { tableName: 'users', schemaName: 'public', displayName: 'users' },
      { tableName: 'orders', schemaName: 'public', displayName: 'orders' },
      { tableName: 'audit', schemaName: 'public', displayName: 'audit' },
    ];

    expect(isSidebarTablePinned(pinnedSidebarTables, 'conn-1', 'main', 'orders', 'public')).toBe(true);
    expect(sortSidebarTableEntries(entries, {
      connectionId: 'conn-1',
      dbName: 'main',
      sortBy: 'frequency',
      tableAccessCount: {
        'conn-1-main-users': 10,
        'conn-1-main-orders': 1,
        'conn-1-main-audit': 3,
      },
      pinnedSidebarTables,
    }).map((entry) => entry.tableName)).toEqual(['orders', 'users', 'audit']);
  });

  it('keeps the v2 table pin action on sidebar table rows', () => {
    const source = readSidebarSource();
    const css = readV2ThemeCss();

    expect(source).toContain('data-v2-sidebar-table-pin-action="true"');
    expect(source).toContain('node?.dataRef?.pinnedSidebarTable ? <StarFilled /> : <StarOutlined />');
    expect(source).toContain('toggleSidebarTablePinned(node);');
    expect(source).toContain("message.success(shouldPin ? t('sidebar.message.table_pinned') : t('sidebar.message.table_unpinned'));");
    expect(css).toMatch(/\.gn-v2-table-pin-action \{[^}]*opacity: 0;/s);
    expect(css).toMatch(/\.gn-v2-table-pin-action\.is-pinned \{[^}]*color: #f59e0b;[^}]*opacity: 1;/s);
    expect(css).toMatch(/\.ant-tree-node-content-wrapper:hover \.gn-v2-table-pin-action,/s);
  });

  it('splits v2 sidebar pinned tables into a dedicated table section', () => {
    const source = readSidebarSource();
    const sectionBuilderSourceStart = source.indexOf('export const buildV2SidebarTableSectionedChildren = (');
    const sectionBuilderSourceEnd = source.indexOf('export const buildSidebarTableChildrenForUi = (');
    const sectionBuilderSource = source.slice(sectionBuilderSourceStart, sectionBuilderSourceEnd);

    expect(sectionBuilderSource).toContain("buildSectionNode('pinned', translate('table_overview.section.pinned'))");
    expect(sectionBuilderSource).toContain("buildSectionNode('all', translate('table_overview.section.all'))");
    expect(sectionBuilderSource).not.toContain("'置顶'");
    expect(sectionBuilderSource).not.toContain("'全部'");

    setCurrentLanguage('en-US');

    const children = buildV2SidebarTableSectionedChildren('conn-main-tables', [
      { title: 'orders', key: 'orders', type: 'table', dataRef: { pinnedSidebarTable: true } },
      { title: 'users', key: 'users', type: 'table', dataRef: { pinnedSidebarTable: false } },
      { title: 'audit', key: 'audit', type: 'table', dataRef: {} },
    ]);

    expect(children.map((node) => node.title)).toEqual(['Pinned', 'orders', 'All', 'users', 'audit']);
    expect(children.map((node) => node.type)).toEqual(['v2-table-section', 'table', 'v2-table-section', 'table', 'table']);
    expect(children[0]).toMatchObject({
      key: 'conn-main-tables-v2-pinned-tables-section',
      isLeaf: true,
      selectable: false,
      dataRef: { sectionKind: 'pinned' },
    });
    expect(children[2]).toMatchObject({
      key: 'conn-main-tables-v2-all-tables-section',
      isLeaf: true,
      selectable: false,
      dataRef: { sectionKind: 'all' },
    });
  });

  it('keeps legacy sidebar table groups flat and ignores v2 pin sections', () => {
    const tableNodes = [
      { title: 'orders', key: 'orders', type: 'table' as const, dataRef: { pinnedSidebarTable: true } },
      { title: 'users', key: 'users', type: 'table' as const, dataRef: { pinnedSidebarTable: false } },
    ];
    const source = readSidebarSource();

    expect(buildSidebarTableChildrenForUi('conn-main-tables', tableNodes, false)).toBe(tableNodes);
    expect(buildSidebarTableChildrenForUi('conn-main-tables', tableNodes, true).map((node) => node.title)).toEqual([
      '置顶',
      'orders',
      '全部',
      'users',
    ]);
    expect(source).toContain('pinnedSidebarTables: isV2Ui ? currentPinnedSidebarTables : []');
    expect(source).toContain('buildSidebarTableChildrenForUi(groupNodeKey, children, isV2Ui)');
  });

  it('keeps v2 table sections out of regular table lists when nothing is pinned', () => {
    const tableNodes = [
      { title: 'users', key: 'users', type: 'table' as const, dataRef: { pinnedSidebarTable: false } },
    ];

    expect(buildV2SidebarTableSectionedChildren('conn-main-tables', tableNodes)).toBe(tableNodes);
  });

  it('renders v2 table section labels as tree children instead of group header badges', () => {
    const source = readSidebarSource();
    const css = readV2ThemeCss();

    expect(source).toContain("node.type === 'v2-table-section'");
    expect(source).toContain('className="gn-v2-tree-section-title"');
    expect(source).not.toContain('gn-v2-tree-section-label');
    expect(source).toContain("if (isV2Ui && node?.type === 'v2-table-section')");
    expect(source).toContain("if (isV2Ui && info?.node?.type === 'v2-table-section')");
    expect(css).toContain('.gn-v2-tree-section-title');
    expect(css).toContain('.ant-tree-treenode:has(.gn-v2-tree-section-title)');
  });

  it('formats v2 table context menu stats like the prototype header', () => {
    setCurrentLanguage('en-US');

    expect(formatV2TableContextMenuRows(undefined)).toBe('— rows');
    expect(formatV2TableContextMenuRows(2)).toBe('2 rows');
    expect(formatV2TableContextMenuSize(16 * 1024)).toBe('16 KB');
  });

  it('formats v2 table context menu row counts with the current UI locale', () => {
    setCurrentLanguage('de-DE');

    expect(formatV2TableContextMenuRows(1234)).toBe('1.234 Zeilen');
  });

  it('localizes v2 table context menu stats meta copy', () => {
    setCurrentLanguage('en-US');

    expect(renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    )).toContain('Click refresh to load stats');

    expect(renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" stats={{ loading: true }} />,
    )).toContain('Loading table stats...');

    expect(renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" stats={{ unavailable: true }} />,
    )).toContain('Table stats unavailable');

    expect(renderToStaticMarkup(
      <V2TableContextMenuView
        tableName="t1"
        stats={{
          rowCount: 2,
          dataLength: 16 * 1024,
          indexLength: 16 * 1024,
        }}
      />,
    )).toContain('2 rows · 16 KB data · 16 KB indexes');
  });

  it('localizes v2 table context menu primary action copy in english', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    );

    expect(markup).toContain('View data');
    expect(markup).toContain('Pin table');
    expect(markup).toContain('Design table · columns / indexes / foreign keys');
    expect(markup).toContain('Open in new tab');
    expect(markup).toContain('New query');
    expect(markup).not.toContain('查看数据');
    expect(markup).not.toContain('设计表 · 字段 / 索引 / 外键');
    expect(markup).not.toContain('在新标签打开');
  });

  it('localizes v2 table context menu metadata copy in english while keeping raw create table', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    );

    expect(markup).toContain('Metadata');
    expect(markup).toContain('View DDL · CREATE TABLE');
    expect(markup).toContain('View in ER diagram');
    expect(markup).toContain('CREATE TABLE');
    expect(markup).not.toContain('元信息');
    expect(markup).not.toContain('查看 DDL · CREATE TABLE');
    expect(markup).not.toContain('在 ER 图中查看');
  });

  it('localizes v2 table context menu copy block in english while keeping raw ddl and insert', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    );

    expect(markup).toContain('Copy');
    expect(markup).toContain('Copy table name');
    expect(markup).toContain('Copy table structure · DDL');
    expect(markup).toContain('Copy entire table as INSERT');
    expect(markup).toContain('DDL');
    expect(markup).toContain('INSERT');
    expect(markup).not.toContain('复制表名');
    expect(markup).not.toContain('复制表结构 · DDL');
    expect(markup).not.toContain('复制全表为 INSERT');
  });

  it('localizes v2 table context menu maintenance block in english while keeping raw rollup and sql dump', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" supportsStarRocksRollup />,
    );

    expect(markup).toContain('Maintenance');
    expect(markup).toContain('Rename...');
    expect(markup).toContain('New Rollup');
    expect(markup).toContain('Backup · SQL Dump');
    expect(markup).toContain('Refresh stats');
    expect(markup).toContain('Rollup');
    expect(markup).toContain('SQL Dump');
    expect(markup).not.toContain('维护');
    expect(markup).not.toContain('重命名…');
    expect(markup).not.toContain('新增 Rollup');
    expect(markup).not.toContain('备份 · SQL Dump');
    expect(markup).not.toContain('刷新统计信息');
  });

  it('localizes v2 table context menu export block in english while keeping raw file formats and extensions', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    );

    expect(markup).toContain('Export table data');
    expect(markup).toContain('Open export workbench...');
    expect(markup).not.toContain('Excel · .xlsx');
    expect(markup).not.toContain('CSV · .csv');
    expect(markup).not.toContain('JSON · .json');
    expect(markup).not.toContain('导出表数据');
  });

  it('localizes v2 table context menu ai block in english', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" />,
    );

    expect(markup).toContain('Use AI to explain this table');
    expect(markup).toContain('Use AI to generate a query');
    expect(markup).not.toContain('用 AI 解释这张表');
    expect(markup).not.toContain('用 AI 生成查询');
  });

  it('localizes v2 table context menu danger block in english while keeping raw truncate and drop', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" supportsTruncate />,
    );

    expect(markup).toContain('Truncate table · TRUNCATE');
    expect(markup).toContain('Delete table · DROP');
    expect(markup).toContain('TRUNCATE');
    expect(markup).toContain('DROP');
    expect(markup).not.toContain('截断表 · TRUNCATE');
    expect(markup).not.toContain('删除表 · DROP');
  });

  it('keeps the v2 table context menu danger block raw truncate token outside the ru-RU label', () => {
    setCurrentLanguage('ru-RU');

    const markup = renderToStaticMarkup(
      <V2TableContextMenuView tableName="t1" supportsTruncate />,
    );

    expect(markup).toContain('TRUNCATE');
    expect(markup).not.toContain('TRUNCATE · TRUNCATE');
    expect(markup).not.toContain('через TRUNCATE · TRUNCATE');
  });

  it('renders the v2 database context menu with the redesigned grouped layout', () => {
    const markup = renderToStaticMarkup(
      <V2DatabaseContextMenuView
        dbName="mkefu_ai_dev"
        dialect="starrocks"
        supportsStarRocksActions
      />,
    );

    expect(markup).toContain('data-v2-database-context-menu="true"');
    expect(markup).toContain('mkefu_ai_dev');
    expect(markup).toContain('DB');
    expect(markup).toContain(t('sidebar.menu.copy_database_name'));
    expect(markup).toContain(t('sidebar.menu.create_table'));
    expect(markup).toContain(t('sidebar.menu.new_query'));
    expect(markup).toContain(t('sidebar.sql_file_exec.title'));
    expect(markup).toContain('StarRocks');
    expect(markup).toContain(t('sidebar.v2_database_menu.new_materialized_view'));
    expect(markup).toContain(t('sidebar.v2_database_menu.new_external_catalog'));
    expect(markup).toContain(t('sidebar.v2_table_menu.maintenance_section'));
    expect(markup).toContain(t('sidebar.menu.rename_database'));
    expect(markup).toContain(t('sidebar.v2_database_menu.refresh_object_tree'));
    expect(markup).toContain(t('sidebar.menu.close_database'));
    expect(markup).toContain(t('sidebar.v2_database_menu.export_backup_section'));
    expect(markup).toContain(t('sidebar.v2_database_menu.export_all_table_schema_sql'));
    expect(markup).toContain(t('sidebar.v2_database_menu.backup_all_tables_sql'));
    expect(markup).toContain(t('sidebar.v2_table_menu.item_with_suffix', { label: t('sidebar.menu.delete_database'), suffix: 'DROP' }));
  });

  it('resolves and wires database-name copy for both sidebar menu generations', () => {
    expect(resolveSidebarDatabaseNameForCopy({
      title: 'fallback_db',
      dataRef: { dbName: '  main_db  ' },
    })).toBe('main_db');
    expect(resolveSidebarDatabaseNameForCopy({ title: ' fallback_db ' })).toBe('fallback_db');
    expect(resolveSidebarDatabaseNameForCopy(null)).toBe('');

    const legacySource = readLegacyNodeMenuSource();
    const menuSource = readSourceFile('./V2TableContextMenu.tsx');
    const actionSource = readSourceFile('./sidebar/useSidebarV2ActionHandlers.tsx');
    const objectActionSource = readSourceFile('./sidebar/useSidebarObjectActions.tsx');

    expect(legacySource).toContain("t('sidebar.menu.copy_database_name')");
    expect(legacySource).toContain("handleV2DatabaseContextMenuAction(node, 'copy-database-name')");
    expect(menuSource).toContain("action: 'copy-database-name'");
    expect(menuSource).toContain("t('sidebar.menu.copy_database_name')");
    expect(actionSource).toContain("case 'copy-database-name':");
    expect(actionSource).toContain('void handleCopyDatabaseName(node);');
    expect(objectActionSource).toContain('const handleCopyDatabaseName = async (node: any) => {');
    expect(objectActionSource).toContain('await navigator.clipboard.writeText(databaseName);');
  });

  it('renders the v2 database schema action for PostgreSQL-compatible databases', () => {
    const markup = renderToStaticMarkup(
      <V2DatabaseContextMenuView
        dbName="app_db"
        dialect="postgres"
        supportsSchemaActions
      />,
    );

    expect(markup).toContain('新建模式');
  });

  it('localizes v2 database context menu actions in english while keeping raw database dialect tokens', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2DatabaseContextMenuView
        dbName="mkefu_ai_dev"
        dialect="starrocks"
        supportsStarRocksActions
      />,
    );

    expect(markup).toContain('mkefu_ai_dev');
    expect(markup).toContain('DB');
    expect(markup).toContain('starrocks · Database actions');
    expect(markup).toContain('New table');
    expect(markup).toContain('New query');
    expect(markup).toContain('Run external SQL file');
    expect(markup).toContain('StarRocks');
    expect(markup).toContain('New materialized view');
    expect(markup).toContain('New external Catalog');
    expect(markup).toContain('Maintenance');
    expect(markup).toContain('Rename database');
    expect(markup).toContain('Refresh object tree');
    expect(markup).toContain('Close database');
    expect(markup).toContain('Export and backup');
    expect(markup).toContain('Export all table schemas · SQL');
    expect(markup).toContain('Back up all tables · schema + data SQL');
    expect(markup).toContain('Delete database · DROP');
    expect(markup).toContain('StarRocks');
    expect(markup).toContain('Catalog');
    expect(markup).toContain('SQL');
    expect(markup).toContain('DROP');
    expect(markup).not.toContain('数据库操作');
    expect(markup).not.toContain('新建表');
    expect(markup).not.toContain('新建物化视图');
    expect(markup).not.toContain('新建外部 Catalog');
    expect(markup).not.toContain('关闭数据库');
    expect(markup).not.toContain('导出与备份');
    expect(markup).not.toContain('删除数据库 · DROP');
  });

  it('localizes the v2 database schema action in english', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2DatabaseContextMenuView
        dbName="app_db"
        dialect="postgres"
        supportsSchemaActions
      />,
    );

    expect(markup).toContain('New schema');
    expect(markup).not.toContain('新建模式');
  });

  it('routes v2 database context menu shell copy through i18n wrappers in Sidebar', () => {
    const source = readSidebarSource();
    const objectActionsSource = readSourceFile('./sidebar/useSidebarObjectActions.tsx');
    const v2ActionHandlersSource = readSourceFile('./sidebar/useSidebarV2ActionHandlers.tsx');
    const createSchemaSource = objectActionsSource.slice(
      objectActionsSource.indexOf('const openCreateSchemaModal = (node: any) => {'),
      objectActionsSource.indexOf('const openRenameSchemaModal = (node: any) => {'),
    );
    const runSqlSource = source.slice(
      source.indexOf('const handleRunSQLFile = async (node: any) => {'),
      source.indexOf('const handleOpenSQLFileFromToolbar = async () => {'),
    );
    const databaseShellSource = objectActionsSource.slice(
      objectActionsSource.indexOf('const handleRenameDatabase = async () => {'),
      objectActionsSource.indexOf('const handleRenameTable = async () => {'),
    );
    const databaseActionSource = v2ActionHandlersSource.slice(
      v2ActionHandlersSource.indexOf('const closeDatabaseNode = (node: any) => {'),
      v2ActionHandlersSource.indexOf('const openDatabaseQuery = (node: any) => {'),
    );
    const starRocksSource = objectActionsSource.slice(
      objectActionsSource.indexOf('const openCreateStarRocksMaterializedView = (node: any) => {'),
      objectActionsSource.indexOf('const openCreateStarRocksRollup = (node: any) => {'),
    );

    expect(createSchemaSource).toContain("message.warning(t('sidebar.message.schema_create_unsupported'))");
    expect(createSchemaSource).toContain("message.error(t('sidebar.message.schema_target_missing'))");
    expect(createSchemaSource).toContain("message.success(t('sidebar.message.schema_created'))");
    expect(createSchemaSource).toContain("message.error(t('sidebar.message.operation_create_failed'");
    expect(source).toContain("t('sidebar.v2_database_menu.new_schema')");
    expect(source).toContain("t('sidebar.field.schema_name')");
    expect(source).toContain("t('sidebar.validation.schema_name_required')");

    expect(runSqlSource).toContain("message.error(t('sidebar.message.connection_config_not_found'))");
    expect(runSqlSource).toContain("data.fileName || t('sidebar.sql_file_exec.title')");
    expect(runSqlSource).toContain("message.error(t('sidebar.message.read_file_failed'");

    expect(databaseShellSource).toContain("message.error(t('sidebar.message.database_name_required'))");
    expect(databaseShellSource).toContain("message.warning(t('sidebar.message.database_name_unchanged'))");
    expect(databaseShellSource).toContain("message.success(t('sidebar.message.database_renamed'))");
    expect(databaseShellSource).toContain("message.error(t('sidebar.message.operation_rename_failed'");
    expect(databaseShellSource).toContain("title: t('sidebar.modal.confirm_delete_database.title')");
    expect(databaseShellSource).toContain("content: t('sidebar.modal.confirm_delete_database.content', { name: dbName })");
    expect(databaseShellSource).toContain("message.success(t('sidebar.message.database_deleted'))");
    expect(databaseShellSource).toContain("message.error(t('sidebar.message.operation_drop_failed'");
    expect(source).toContain("t('sidebar.modal.rename_database.title'");
    expect(source).toContain("t('sidebar.field.new_database_name')");
    expect(source).toContain("t('sidebar.validation.new_database_name_required')");

    expect(databaseActionSource).toContain("message.success(t('sidebar.message.database_closed'))");

    expect(starRocksSource).toContain("title: t('sidebar.v2_database_menu.new_materialized_view')");
    expect(starRocksSource).toContain("title: t('sidebar.v2_database_menu.new_external_catalog')");
  });

  it('localizes the v2 schema context menu while keeping raw schema and SQL tokens', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2SchemaContextMenuView
        dbName="app_db"
        schemaName="sales"
      />,
    );

    expect(markup).toContain('data-v2-schema-context-menu="true"');
    expect(markup).toContain('sales');
    expect(markup).toContain('SCHEMA');
    expect(markup).toContain('app_db · Schema actions');
    expect(markup).toContain('Maintenance');
    expect(markup).toContain('Edit schema');
    expect(markup).toContain('Refresh object tree');
    expect(markup).toContain('Export and backup');
    expect(markup).toContain('Export current schema table structures · SQL');
    expect(markup).toContain('Back up all current schema tables · schema + data');
    expect(markup).toContain('Delete schema · DROP CASCADE');
    ['当前数据库', '模式操作', '维护', '编辑模式', '刷新对象树', '导出与备份', '导出当前模式表结构', '备份当前模式全部表', '删除模式'].forEach((rawSnippet) => {
      expect(markup).not.toContain(rawSnippet);
    });
  });

  it('renders the v2 connection context menu for host rail actions', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2ConnectionContextMenuView
        connectionName="dev240"
        hostSummary="10.0.0.240:3306"
        driverLabel="mysql"
        tags={[
          { id: 'prod', name: '生产环境', selected: true },
          { id: 'debug', name: '临时调试' },
        ]}
      />,
    );

    expect(markup).toContain('data-v2-connection-context-menu="true"');
    expect(markup).toContain('dev240');
    expect(markup).toContain('mysql · 10.0.0.240:3306');
    expect(markup).toContain(t('connection.sidebar.menu.hostBadge'));
    expect(markup).toContain(t('connection.sidebar.menu.createDatabase'));
    expect(markup).toContain(t('connection.sidebar.menu.refresh'));
    expect(markup).toContain(t('sidebar.menu.new_query'));
    expect(markup).toContain(t('sidebar.sql_file_exec.title'));
    expect(markup).toContain(t('sidebar.menu.edit_connection'));
    expect(markup).toContain(t('connection.sidebar.menu.copy'));
    expect(markup).toContain(t('connection.sidebar.menu.disconnect'));
    expect(markup).toContain(t('connection.sidebar.menu.groupSection'));
    expect(markup).toContain('生产环境');
    expect(markup).toContain('临时调试');
    expect(markup).toContain(t('connection.sidebar.menu.moveToUngrouped'));
    expect(markup).toContain(t('connection.sidebar.menu.delete'));
  });

  it('renders localized connection action labels in the v2 menu', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2ConnectionContextMenuView
        connectionName="dev240"
        driverLabel="mysql"
        tags={[
          { id: 'prod', name: 'Production', selected: true },
          { id: 'debug', name: 'Debug' },
        ]}
      />,
    );

    expect(markup).toContain('mysql · Address not configured');
    expect(markup).toContain(t('connection.sidebar.menu.hostBadge'));
    expect(markup).toContain('New database');
    expect(markup).toContain('Refresh connection');
    expect(markup).toContain('New query');
    expect(markup).toContain('Run external SQL file');
    expect(markup).toContain('Edit connection');
    expect(markup).toContain('Connection');
    expect(markup).toContain('Copy connection');
    expect(markup).toContain('Disconnect');
    expect(markup).toContain('Connection groups');
    expect(markup).toContain('Current');
    expect(markup).toContain('Remove from group');
    expect(markup).toContain('Delete connection');
  });

  it('localizes v2 connection shell fallbacks and group controls without changing raw names', () => {
    const source = readSidebarSource();
    const menuSource = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
    const utilsSource = readFileSync(new URL('./sidebarV2Utils.ts', import.meta.url), 'utf8');

    expect(source).toContain("connectionName={String(conn?.name || node.title || t('connection.unnamed'))}");
    expect(source).toContain("title: String(node.title || conn.name || t('connection.unnamed'))");
    expect(source).toContain("meta: resolveConnectionHostSummary(conn.config) || conn.config?.type || t('connection.sidebar.menu.section')");
    expect(source).toContain("title: String(node.title || dataRef.dbName || t('database.unnamed'))");
    expect(source).toContain("meta: conn?.name || dataRef.id || t('database.label')");
    expect(source).toContain("const activeConnectionDisplayName = String(activeConnection?.name || '').trim() || t('sidebar.active_connection.no_host_selected');");
    expect(source).toContain('const v2ActiveConnectionTooltipContent = (');
    expect(source).toContain('<div className="gn-v2-active-connection-tooltip">');
    expect(source).toContain('<strong>{activeConnectionDisplayName}</strong>');
    expect(source).toContain('<span>{activeDatabaseDisplayName || v2NoDatabaseSelectedLabel}</span>');
    expect(source.match(/<Tooltip title=\{v2ActiveConnectionTooltipContent\} placement="bottomLeft" mouseEnterDelay=\{0\.35\}>/g)).toHaveLength(2);
    expect(source).not.toContain('<strong title={activeConnectionDisplayName}>');
    expect(source).not.toContain('<span title={activeDatabaseDisplayName || v2NoDatabaseSelectedLabel}>');
    expect(utilsSource).toContain("name: item.tag.name || t('connection.sidebar.group.untitled'),");
    expect(source).toContain('groupName={group.name}');
    expect(source).toContain('count={group.connections.length}');
    expect(menuSource).toContain("title={groupName || t('connection.sidebar.group.untitled')}");
    expect(menuSource).toContain("meta={t('connection.sidebar.group.meta', { count: count.toLocaleString() })}");
    expect(menuSource).toContain("pill={t('connection.sidebar.group.badge')}");
    expect(menuSource).toContain("title: t('connection.sidebar.group.edit')");
    expect(menuSource).toContain("title: t('connection.sidebar.group.delete')");
    expect(menuSource).toContain("pill={t('connection.sidebar.menu.hostBadge')}");
  });

  it('localizes v2 connection group modals and delete confirmation shells while keeping raw group names', () => {
    const source = readSidebarSource();

    expect(source).toContain("title: t('connection.sidebar.group.deleteConfirmTitle')");
    expect(source).toContain("content: t('connection.sidebar.group.deleteConfirmContent', { name: tag.name })");
    expect(source).toContain("renameViewTarget?.type === 'tag' ? t('sidebar.modal.tag.edit_title') : t('sidebar.modal.tag.create_title')");
    expect(source).toContain("renameViewTarget?.type === 'tag' ? t('sidebar.modal.tag.edit_description') : t('sidebar.modal.tag.create_description')");
    expect(source).toContain("label={t('sidebar.field.tag_name')}");
    expect(source).toContain("message: t('sidebar.validation.tag_name_required')");
    expect(source).toContain("placeholder={t('sidebar.placeholder.tag_name')}");
    expect(source).toContain("label={t('sidebar.field.select_connections')}");
  });

  it('renders localized redis connection action labels in the v2 menu', () => {
    setCurrentLanguage('en-US');

    const markup = renderToStaticMarkup(
      <V2ConnectionContextMenuView
        connectionName="redis-dev"
        driverLabel="redis"
        isRedis
      />,
    );

    expect(markup).toContain('Refresh connection');
    expect(markup).toContain('New command window');
    expect(markup).toContain('Redis instance monitor');
  });

  it('localizes legacy sidebar connection duplicate disconnect and delete copy', () => {
    const source = readSidebarSource();

    expect(source).toContain("t('connection.sidebar.menu.copy')");
    expect(source).toContain("t('connection.sidebar.menu.disconnect')");
    expect(source).toContain("t('connection.sidebar.menu.delete')");
    expect(source).toContain("t('connection.sidebar.duplicate.backendUnavailable')");
    expect(source).toContain("t('connection.sidebar.duplicate.noResult')");
    expect(source).toContain("t('connection.sidebar.duplicate.success'");
    expect(source).toContain("t('connection.sidebar.duplicate.failureFallback')");
    expect(source).toContain("t('connection.sidebar.disconnect.success')");
    expect(source).toContain("t('connection.sidebar.delete.confirmTitle')");
    expect(source).toContain("t('connection.sidebar.delete.confirmContent'");
    expect(source).toContain("t('connection.sidebar.delete.backendUnavailable')");
    expect(source).toContain("t('connection.sidebar.delete.success')");
    expect(source).toContain("t('connection.sidebar.delete.failureFallback')");
  });

  it('localizes the sidebar table pin action title and aria-label via i18n keys', () => {
    const source = readSidebarSource();
    const tablePinActionStart = source.indexOf("const tablePinAction = node.type === 'table' ? (");
    const tablePinActionEnd = source.indexOf('aria-pressed=', tablePinActionStart);
    const tablePinActionSource = source.slice(tablePinActionStart, tablePinActionEnd);
    const normalizedTablePinActionSource = tablePinActionSource.replace(/\s+/g, ' ');

    expect(tablePinActionStart).toBeGreaterThanOrEqual(0);
    expect(tablePinActionEnd).toBeGreaterThan(tablePinActionStart);
    expect(normalizedTablePinActionSource).toContain(
      "title={node?.dataRef?.pinnedSidebarTable ? t('sidebar.action.unpin_table') : t('sidebar.action.pin_table')}",
    );
    expect(normalizedTablePinActionSource).toContain(
      "aria-label={node?.dataRef?.pinnedSidebarTable ? t('sidebar.action.unpin_table') : t('sidebar.action.pin_table')}",
    );
    expect(tablePinActionSource).not.toContain("'取消置顶表'");
    expect(tablePinActionSource).not.toContain("'置顶表'");
  });

  it('localizes legacy sidebar connection and redis menu labels', () => {
    const source = readSidebarSource();
    const connectionMenuStart = source.indexOf('// Connection Tag Menu — must be BEFORE the connection check');
    const connectionMenuSource = source.slice(
      connectionMenuStart,
      source.indexOf("} else if (node.type === 'redis-db') {", connectionMenuStart),
    );

    expect(connectionMenuSource).toContain("t('sidebar.menu.refresh')");
    expect(connectionMenuSource).toContain("t('sidebar.menu.new_command_window')");
    expect(connectionMenuSource).toContain("t('redis_monitor.title.instance')");
    expect(connectionMenuSource).toContain("t('sidebar.menu.edit_connection')");
    expect(connectionMenuSource).toContain("t('connection.sidebar.menu.createDatabase')");
    expect(connectionMenuSource).toContain("t('sidebar.menu.new_query')");
    expect(connectionMenuSource).toContain("t('sidebar.sql_file_exec.title')");
    expect(connectionMenuSource).toContain("t('connection.sidebar.menu.moveToTag')");
    expect(connectionMenuSource).toContain("t('connection.sidebar.menu.moveOutTag')");

    expect(connectionMenuSource).not.toContain("label: '新建数据库'");
    expect(connectionMenuSource).not.toContain("label: '刷新'");
    expect(connectionMenuSource).not.toContain("label: '新建查询'");
    expect(connectionMenuSource).not.toContain("label: '运行外部SQL文件'");
    expect(connectionMenuSource).not.toContain("label: '编辑连接'");
    expect(connectionMenuSource).not.toContain("label: '移至标签'");
    expect(connectionMenuSource).not.toContain("label: '移出标签'");
    expect(connectionMenuSource).not.toContain("label: '新建命令窗口'");
    expect(connectionMenuSource).not.toContain("label: 'Redis 实例监控'");
  });

  it('localizes connection-root tab titles without changing database or redis-db tab title paths', () => {
    const source = readSidebarSource();

    expect(source).toContain("const buildConnectionRootQueryTabTitle = () => t('query.new');");
    expect(source).toContain("const buildConnectionRootRedisCommandTabTitle = (redisDbLabel = 'db0') =>");
    expect(source).toContain("const buildConnectionRootRedisMonitorTabTitle = (redisDbLabel = 'db0') =>");
    expect(source).toContain("t('sidebar.tab.redis_command', { database: redisDbLabel })");
    expect(source).toContain("t('sidebar.tab.redis_monitor', { database: redisDbLabel })");
    expect(source).toContain("title: buildConnectionRootQueryTabTitle()");
    expect(source).toContain("title: buildConnectionRootRedisCommandTabTitle()");
    expect(source).toContain("title: buildConnectionRootRedisMonitorTabTitle()");
    expect(source).toContain("title: t('sidebar.tab.new_query_database', { database: node.title })");
    expect(source).toContain("title: buildConnectionRootRedisCommandTabTitle(`db${redisDB}`)");
    expect(source).toContain("title: buildConnectionRootRedisMonitorTabTitle(`db${redisDB}`)");
  });

  it('keeps redis db key counts in v2 meta and renders aliases separately from the db title', () => {
    const loaderSource = readSourceFile('./sidebar/useSidebarTreeLoaders.tsx');
    const redisLoadStart = loaderSource.indexOf("if (conn.config.type === 'redis') {");
    const redisLoadEnd = loaderSource.indexOf('const res = await DBGetDatabases', redisLoadStart);
    expect(redisLoadStart).toBeGreaterThanOrEqual(0);
    expect(redisLoadEnd).toBeGreaterThan(redisLoadStart);
    const redisLoadSource = loaderSource.slice(redisLoadStart, redisLoadEnd);

    expect(redisLoadSource).toContain('const alias = getRedisDbAlias(redisDbAliases, conn.id, db.index);');
    expect(redisLoadSource).toContain('title: buildRedisDbNodeLabel(');
    expect(redisLoadSource).toContain('dataRef: { ...conn, redisDB: db.index, redisKeyCount: keyCount, redisDbAlias: alias }');
    expect(redisLoadSource).not.toContain("keyCount > 0 ? ` (${keyCount})` : ''");

    const titleSource = readSourceFile('./sidebar/SidebarTreeTitle.tsx');
    expect(titleSource).toContain("node.type === 'redis-db' ? 'is-redis-db' : ''");
    expect(titleSource).toContain("const redisDbAlias = node.type === 'redis-db'");
    expect(titleSource).toContain('className="gn-v2-redis-db-alias"');
  });

  it('localizes sidebar JVM probe and resource failure prompts', () => {
    const source = readSidebarSource();

    expect(source).toContain("t('sidebar.message.jvm_provider_probe_failed_with_diagnostic'");
    expect(source).toContain("t('sidebar.message.jvm_provider_probe_exception_with_diagnostic'");
    expect(source).toContain("t('sidebar.message.connection_failed'");
    expect(source).toContain("t('sidebar.message.no_visible_databases')");
    expect(source).toContain("t('sidebar.message.jvm_resources_backend_unavailable')");
    expect(source).toContain("t('sidebar.message.load_jvm_resources_failed'");
    expect(source).not.toContain('JVM Provider 探测失败：');
    expect(source).not.toContain('JVM Provider 探测异常：');
    expect(source).not.toContain("throw new Error('JVMListResources 后端方法不可用')");

    SUPPORTED_LANGUAGES.forEach((language) => {
      setCurrentLanguage(language);
      expect(
        t('sidebar.message.jvm_provider_probe_failed_with_diagnostic', { error: 'boom' }),
      ).not.toBe('sidebar.message.jvm_provider_probe_failed_with_diagnostic');
      expect(
        t('sidebar.message.jvm_provider_probe_exception_with_diagnostic', { error: 'boom' }),
      ).not.toBe('sidebar.message.jvm_provider_probe_exception_with_diagnostic');
    });
  });

  it('localizes v2 saved-query and external SQL root shell copy', () => {
    const source = readSidebarSource();
    const legacyMenuSource = readLegacyNodeMenuSource();
    const loadTablesStart = source.indexOf('const loadTables = async (node: any) => {');
    const loadTablesEnd = source.indexOf('const config = {', loadTablesStart);
    const loadTablesSource = source.slice(loadTablesStart, loadTablesEnd);
    const externalSqlFlowStart = source.indexOf('const handleAddExternalSQLDirectory = async (node: any) => {');
    const externalSqlFlowEnd = source.indexOf('const cancelSQLFileExecution = () => {', externalSqlFlowStart);
    const externalSqlFlowSource = source.slice(externalSqlFlowStart, externalSqlFlowEnd);
    const treeTitleSource = readSourceFile('./sidebar/SidebarTreeTitle.tsx');
    const treeTitleStart = 0;
    const treeTitleEnd = treeTitleSource.length;
    const externalSqlMenuStart = legacyMenuSource.indexOf("if (node.type === 'external-sql-root') {", legacyMenuSource.indexOf('// 已存查询节点的右键菜单'));
    const externalSqlMenuEnd = legacyMenuSource.indexOf("if (node.type === 'external-sql-directory') {", externalSqlMenuStart);
    const externalSqlMenuSource = legacyMenuSource.slice(externalSqlMenuStart, externalSqlMenuEnd);
    const externalSqlDirectoryMenuStart = externalSqlMenuEnd;
    const externalSqlDirectoryMenuEnd = legacyMenuSource.indexOf("if (node.type === 'external-sql-file') {", externalSqlDirectoryMenuStart);
    const externalSqlDirectoryMenuSource = legacyMenuSource.slice(externalSqlDirectoryMenuStart, externalSqlDirectoryMenuEnd);
    const externalSqlFileMenuStart = externalSqlDirectoryMenuEnd;
    const externalSqlFileMenuEnd = legacyMenuSource.indexOf('return [];', externalSqlFileMenuStart);
    const externalSqlFileMenuSource = legacyMenuSource.slice(externalSqlFileMenuStart, externalSqlFileMenuEnd);
    const titleRenderSource = readSourceFile('./sidebar/useSidebarTitleRender.tsx');
    const titleRenderStart = titleRenderSource.indexOf('export const useSidebarTitleRender =');
    const titleRenderEnd = titleRenderSource.length;

    [
      loadTablesStart,
      loadTablesEnd,
      externalSqlFlowStart,
      externalSqlFlowEnd,
      treeTitleStart,
      treeTitleEnd,
      externalSqlMenuStart,
      externalSqlMenuEnd,
      externalSqlDirectoryMenuStart,
      externalSqlDirectoryMenuEnd,
      externalSqlFileMenuStart,
      externalSqlFileMenuEnd,
      titleRenderStart,
      titleRenderEnd,
    ].forEach((index) => expect(index).toBeGreaterThanOrEqual(0));

    expect(loadTablesSource).toContain("title: t('sidebar.tree.saved_queries')");
    expect(loadTablesSource).not.toContain("title: '已存查询'");
    expect(source).not.toContain('const externalSQLDirectoryResults = await Promise.all(');
    expect(loadTablesSource).not.toContain('SQL 目录读取失败');
    expect(loadTablesSource).not.toContain("'SQL目录'");

    expect(externalSqlFlowSource).toContain("message.error(t('sidebar.message.select_sql_directory_failed'");
    expect(externalSqlFlowSource).toContain("message.error(t('sidebar.message.sql_directory_path_invalid'))");
    expect(externalSqlFlowSource).toContain("t('sidebar.sql_directory.default_name')");
    expect(externalSqlFlowSource).toContain("message.success(t('sidebar.message.external_sql_directory_added'))");
    expect(externalSqlFlowSource).toContain("message.error(t('sidebar.message.external_sql_directory_not_found'))");
    expect(externalSqlFlowSource).toContain("message.success(t('sidebar.message.external_sql_directory_removed'))");
    expect(externalSqlFlowSource).toContain("message.success(t('sidebar.message.external_sql_directory_refreshed'))");
    expect(externalSqlFlowSource).not.toContain("sidebar.message.add_sql_directory_database_required");
    expect(externalSqlFlowSource).not.toContain("sidebar.message.external_sql_directory_context_missing");
    [
      '选择 SQL 目录失败',
      '未获取到有效的 SQL 目录路径',
      '外部 SQL 目录已添加',
      '未找到可移除的 SQL 目录',
      '外部 SQL 目录已移除',
      '外部 SQL 目录已刷新',
    ].forEach((rawSnippet) => {
      expect(externalSqlFlowSource).not.toContain(rawSnippet);
    });
    expect(externalSqlFlowSource).not.toContain("'SQL目录'");

    expect(treeTitleSource).toContain("if (node.type === 'queries-folder') return t('sidebar.tree.saved_queries');");
    expect(treeTitleSource).toContain("if (node.type === 'external-sql-root') return t('sidebar.external_sql.root');");
    expect(treeTitleSource).not.toContain('已存查询 · saved');
    expect(treeTitleSource).not.toContain('外部 SQL 目录');

    expect(externalSqlMenuSource).toContain("label: t('sidebar.menu.add_sql_directory')");
    expect(externalSqlMenuSource).not.toContain("label: '添加 SQL 目录'");
    expect(externalSqlDirectoryMenuSource).toContain("label: t('sidebar.menu.refresh_directory')");
    expect(externalSqlDirectoryMenuSource).toContain("label: t('sidebar.menu.remove_directory')");
    expect(externalSqlDirectoryMenuSource).not.toContain("label: '刷新目录'");
    expect(externalSqlDirectoryMenuSource).not.toContain("label: '移除目录'");
    expect(externalSqlFileMenuSource).toContain("label: t('sidebar.menu.open_sql_file')");
    expect(externalSqlFileMenuSource).not.toContain("label: '打开 SQL 文件'");

    expect(titleRenderSource).toContain("const externalSqlRootTitle = t('sidebar.external_sql.root');");
    expect(titleRenderSource).toContain("const addSqlDirectoryLabel = t('sidebar.menu.add_sql_directory');");
    expect(titleRenderSource).toContain('title={externalSqlRootTitle}');
    expect(titleRenderSource).toContain('title={addSqlDirectoryLabel}');
    expect(titleRenderSource).toContain('aria-label={addSqlDirectoryLabel}');
    expect(titleRenderSource).not.toContain('title="添加外部 SQL 目录"');
    expect(titleRenderSource).not.toContain('aria-label="添加外部 SQL 目录"');

    [
      'sidebar.tree.saved_queries',
      'sidebar.external_sql.root',
      'sidebar.menu.add_sql_directory',
      'sidebar.menu.refresh_directory',
      'sidebar.menu.remove_directory',
      'sidebar.menu.open_sql_file',
      'sidebar.message.select_sql_directory_failed',
      'sidebar.message.sql_directory_path_invalid',
      'sidebar.sql_directory.default_name',
      'sidebar.message.external_sql_directory_added',
      'sidebar.message.external_sql_directory_not_found',
      'sidebar.message.external_sql_directory_removed',
      'sidebar.message.external_sql_directory_refreshed',
      'sidebar.message.external_sql_directory_read_failed',
    ].forEach((key) => {
      SUPPORTED_LANGUAGES.forEach((language) => {
        setCurrentLanguage(language);
        expect(t(key, { name: 'raw_dir', error: 'raw_error' })).not.toBe(key);
      });
    });
  });

  it('omits unsupported database management actions for Oracle-like connection and database menus', () => {
    const connectionMarkup = renderToStaticMarkup(
      <V2ConnectionContextMenuView
        connectionName="dm-prod"
        hostSummary="10.0.0.10:5236"
        driverLabel="dameng"
        supportsCreateDatabase={false}
      />,
    );
    const databaseMarkup = renderToStaticMarkup(
      <V2DatabaseContextMenuView
        dbName="SYSDBA"
        dialect="dm"
        supportsRenameDatabase={false}
        supportsDropDatabase={false}
      />,
    );

    expect(connectionMarkup).not.toContain('新建数据库');
    expect(databaseMarkup).not.toContain('重命名数据库');
    expect(databaseMarkup).not.toContain('删除数据库 · DROP');
    expect(databaseMarkup).toContain('刷新对象树');
    expect(databaseMarkup).toContain('关闭数据库');
  });

  it('localizes the sql file execution progress shell with current UI locale while keeping raw sql text', () => {
    setCurrentLanguage('en-US');

    const runningMarkup = renderToStaticMarkup(
      <SQLFileExecutionProgressContent
        fileSizeMB="12.5"
        status="running"
        executed={3}
        failed={1}
        percent={45}
        currentSQL="SELECT * FROM users"
        resultMessage=""
      />,
    );
    const runningFooterMarkup = renderToStaticMarkup(
      <>{buildSQLFileExecutionFooter({
        status: 'running',
        onCancelExecution: mocks.noop,
        onClose: mocks.noop,
      })}</>,
    );
    const doneFooterMarkup = renderToStaticMarkup(
      <>{buildSQLFileExecutionFooter({
        status: 'done',
        onCancelExecution: mocks.noop,
        onClose: mocks.noop,
      })}</>,
    );
    const errorMarkup = renderToStaticMarkup(
      <SQLFileExecutionProgressContent
        fileSizeMB="12.5"
        status="error"
        executed={3}
        failed={1}
        percent={100}
        currentSQL="SELECT * FROM users"
        resultMessage="third-party raw error"
      />,
    );

    expect(runningMarkup).toContain('File size:');
    expect(runningMarkup).toContain('Status:');
    expect(runningMarkup).toContain('Running');
    expect(runningMarkup).toContain('Executed:');
    expect(runningMarkup).toContain('rows | Failed:');
    expect(runningMarkup).toContain('SELECT * FROM users');
    expect(runningMarkup).not.toContain('文件大小：');
    expect(runningMarkup).not.toContain('状态：');
    expect(runningMarkup).not.toContain('执行中');
    expect(runningFooterMarkup).toContain('Cancel execution');
    expect(doneFooterMarkup).toContain('Close');
    expect(errorMarkup).toContain('Error');
    expect(errorMarkup).toContain('third-party raw error');
    expect(errorMarkup).not.toContain('SELECT * FROM users');
  });

  it('renders the v2 table group menu with sort state', () => {
    setCurrentLanguage('en-US');

    const objectGroupTitleCases = [
      ['tables', 'sidebar.v2_table_group_menu.title', '表'],
      ['views', 'sidebar.object_group.views', '视图'],
      ['sequences', 'sidebar.object_group.sequences', '序列'],
      ['routines', 'sidebar.object_group.routines', '函数'],
      ['packages', 'sidebar.object_group.packages', '存储包'],
      ['triggers', 'sidebar.object_group.triggers', '触发器'],
      ['events', 'sidebar.object_group.events', '事件'],
      ['materializedViews', 'sidebar.object_group.materialized_views', '物化视图'],
    ] as const;

    objectGroupTitleCases.forEach(([groupKey, labelKey, rawTitle]) => {
      expect(resolveV2ObjectGroupTitle({
        type: 'object-group',
        dataRef: { groupKey },
      })).toBe(t(labelKey));
    });
    expect(resolveV2ObjectGroupTitle({
      type: 'object-group',
      dataRef: { groupKey: 'schema' },
    })).toBeNull();
    expect(resolveV2ObjectGroupTitle({
      type: 'table',
      dataRef: { groupKey: 'tables' },
    })).toBeNull();

    const markup = renderToStaticMarkup(
      <V2TableGroupContextMenuView
        dbName="mkefu_ai_dev"
        count={15}
        currentSort="frequency"
      />,
    );

    expect(markup).toContain('data-v2-table-group-context-menu="true"');
    expect(markup).toContain(t('sidebar.v2_table_group_menu.title'));
    expect(markup).toContain(t('sidebar.v2_table_group_menu.meta', {
      database: 'mkefu_ai_dev',
      count: '15',
      sort: t('sidebar.v2_table_group_menu.sort_frequency'),
    }));
    expect(markup).toContain(t('sidebar.menu.create_table'));
    expect(markup).toContain(t('data_grid.context_menu.sort_section'));
    expect(markup).toContain(t('sidebar.menu.sort_by_name'));
    expect(markup).toContain(t('sidebar.menu.sort_by_frequency'));
    expect(markup).toContain(t('data_grid.context_menu.current_marker'));
    ['? ? tables', '表 · tables', '15 张表', '当前按使用频率排序', '新建表'].forEach((rawSnippet) => {
      expect(markup).not.toContain(rawSnippet);
    });

    const sidebarSource = readSidebarSource();
    const start = sidebarSource.indexOf('const renderV2TableGroupContextMenu');
    const end = sidebarSource.indexOf('const renderV2DatabaseContextMenu', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const tableGroupCallSource = sidebarSource.slice(start, end);
    expect(tableGroupCallSource).toContain('<V2TableGroupContextMenuView');
    expect(tableGroupCallSource).not.toContain('title=');
    ['? ? tables', '表 · tables'].forEach((rawSnippet) => {
      expect(tableGroupCallSource).not.toContain(rawSnippet);
    });

    const treeTitleModuleSource = readSourceFile('./sidebar/SidebarTreeTitle.tsx');
    const treeTitleStart = treeTitleModuleSource.indexOf('export const renderSidebarV2TreeTitle');
    const treeTitleEnd = treeTitleModuleSource.length;
    expect(treeTitleStart).toBeGreaterThanOrEqual(0);
    expect(treeTitleEnd).toBeGreaterThan(treeTitleStart);
    const treeTitleSource = treeTitleModuleSource.slice(treeTitleStart, treeTitleEnd);
    expect(treeTitleSource).toContain('const objectGroupTitle = resolveV2ObjectGroupTitle(node);');
    expect(treeTitleSource).toContain('if (objectGroupTitle) return objectGroupTitle;');

    const sidebarHelpersSource = readSourceFile('./sidebar/sidebarHelpers.ts');
    const objectGroupTitleStart = sidebarHelpersSource.indexOf('export const resolveV2ObjectGroupTitle');
    const objectGroupTitleEnd = sidebarHelpersSource.indexOf('export type V2CommandSearchMode', objectGroupTitleStart);
    expect(objectGroupTitleStart).toBeGreaterThanOrEqual(0);
    expect(objectGroupTitleEnd).toBeGreaterThan(objectGroupTitleStart);
    const objectGroupTitleSource = sidebarHelpersSource.slice(objectGroupTitleStart, objectGroupTitleEnd);
    [
      "if (groupKey === 'tables') return t('sidebar.v2_table_group_menu.title');",
      "if (groupKey === 'views') return t('sidebar.object_group.views');",
      "if (groupKey === 'sequences') return t('sidebar.object_group.sequences');",
      "if (groupKey === 'routines') return t('sidebar.object_group.routines');",
      "if (groupKey === 'packages') return t('sidebar.object_group.packages');",
      "if (groupKey === 'triggers') return t('sidebar.object_group.triggers');",
      "if (groupKey === 'events') return t('sidebar.object_group.events');",
      "if (groupKey === 'materializedViews') return t('sidebar.object_group.materialized_views');",
    ].forEach((catalogLookup) => {
      expect(objectGroupTitleSource).toContain(catalogLookup);
    });

    const titleRenderSource = readSourceFile('./sidebar/useSidebarTitleRender.tsx');
    const titleRenderStart = titleRenderSource.indexOf('export const useSidebarTitleRender =');
    const titleRenderEnd = titleRenderSource.length;
    expect(titleRenderStart).toBeGreaterThanOrEqual(0);
    expect(titleRenderEnd).toBeGreaterThan(titleRenderStart);
    expect(titleRenderSource).toContain("} else if (node.type === 'object-group') {");
    expect(titleRenderSource).toContain('const objectGroupTitle = resolveV2ObjectGroupTitle(node);');
    expect(titleRenderSource).toContain('hoverTitle = objectGroupTitle;');
    [
      '? ? tables',
      '表 · tables',
      '视图 · views',
      '函数 · functions',
      '触发器 · triggers',
      '事件 · events',
      '物化视图 · materialized',
    ].forEach((rawSnippet) => {
      expect(treeTitleSource).not.toContain(rawSnippet);
    });
  });

  it('renders sidebar table comments as an opt-in suffix while using the tab-style table hover card', () => {
    const baseNode = {
      type: 'table',
      title: 'users',
      key: 'conn-main-users',
      dataRef: {
        id: 'conn',
        dbName: 'main',
        tableName: 'users',
        tableComment: '用户表',
        rowCount: 7,
        tableSize: 4096,
        createdAt: '2026-07-02 10:11:12',
        updatedAt: '2026-07-03 11:12:13',
      },
    };
    const baseOptions = {
      node: baseNode,
      hoverTitle: 'users',
      statusBadge: null,
      getV2TreeMetaText: () => '',
      toggleSidebarTablePinned: vi.fn(),
      snapshotTreeSelectionBeforeDrag: vi.fn(),
      restoreTreeSelectionAfterDrag: vi.fn(),
      treeDragSelectSuppressUntilRef: { current: 0 },
      setIsTreeDragging: vi.fn(),
    };

    const hiddenSuffixMarkup = renderToStaticMarkup(renderSidebarV2TreeTitle({
      ...baseOptions,
      sidebarTableMetadataFields: ['rows'],
    }));
    expect(hiddenSuffixMarkup).not.toContain('gn-v2-tree-table-comment');

    const visibleSuffixMarkup = renderToStaticMarkup(renderSidebarV2TreeTitle({
      ...baseOptions,
      sidebarTableMetadataFields: ['comment', 'rows', 'size', 'createdAt', 'updatedAt'],
    }));
    expect(visibleSuffixMarkup).toContain('gn-v2-tree-table-comment');
    expect(visibleSuffixMarkup).toContain('用户表');
    expect(visibleSuffixMarkup).toContain(t('sidebar.v2_table_group_menu.metadata_value.rows', { count: '7' }));
    expect(visibleSuffixMarkup).toContain('4 KB');
    expect(visibleSuffixMarkup).toContain(t('sidebar.v2_table_group_menu.metadata_value.created_at', { time: '2026-07-02 10:11' }));
    expect(visibleSuffixMarkup).toContain(t('sidebar.v2_table_group_menu.metadata_value.updated_at', { time: '2026-07-03 11:12' }));

    const sortedSuffixMarkup = renderToStaticMarkup(renderSidebarV2TreeTitle({
      ...baseOptions,
      sidebarTableMetadataFields: ['updatedAt', 'size', 'rows', 'comment', 'createdAt'],
    }));
    expect(sortedSuffixMarkup.indexOf(t('sidebar.v2_table_group_menu.metadata_value.updated_at', { time: '2026-07-03 11:12' })))
      .toBeLessThan(sortedSuffixMarkup.indexOf('4 KB'));
    expect(sortedSuffixMarkup.indexOf('4 KB'))
      .toBeLessThan(sortedSuffixMarkup.indexOf(t('sidebar.v2_table_group_menu.metadata_value.rows', { count: '7' })));
    expect(sortedSuffixMarkup.indexOf(t('sidebar.v2_table_group_menu.metadata_value.rows', { count: '7' })))
      .toBeLessThan(sortedSuffixMarkup.indexOf('用户表'));

    const treeTitleSource = readSourceFile('./sidebar/SidebarTreeTitle.tsx');
    const sidebarHelpersSource = readSourceFile('./sidebar/sidebarHelpers.ts');
    expect(treeTitleSource).toContain('data-sidebar-table-hover-info="true"');
    expect(treeTitleSource).toContain('rootClassName="gn-v2-tab-hover-tooltip gn-v2-sidebar-table-hover-tooltip"');
    expect(treeTitleSource).toContain('title={tableHoverInfo ? undefined : effectiveHoverTitle}');
    expect(treeTitleSource).toContain("const SIDEBAR_TREE_NODE_CONTENT_SELECTOR = '.ant-tree-node-content-wrapper';");
    expect(treeTitleSource).toContain("removeAttribute('title')");
    expect(treeTitleSource).toContain('ref={tableHoverInfo ? clearSidebarTableNativeHoverTitleRef : undefined}');
    expect(treeTitleSource).toContain('onPointerOverCapture={tableHoverInfo ? clearSidebarTableNativeHoverTitle : undefined}');
    expect(treeTitleSource).toContain("resolveConnectionHostSummary(dataRef.config)");
    expect(treeTitleSource).toContain("t('tab_manager.kind_badge.table')");
    expect(treeTitleSource).toContain("t('tab_manager.hover.kind.table')");
    expect(treeTitleSource).toContain("t('table_designer.action.table_comment')");
    expect(sidebarHelpersSource).toContain("t('sidebar.v2_table_group_menu.metadata_value.rows'");
    expect(treeTitleSource).toContain("t('sidebar.v2_table_group_menu.display_table_size')");
    expect(treeTitleSource).toContain("t('sidebar.v2_table_group_menu.display_create_time')");
    expect(treeTitleSource).toContain("t('sidebar.v2_table_group_menu.display_update_time')");
    expect(treeTitleSource).toContain('mouseEnterDelay={1.2}');

    const css = readV2ThemeCss();
    expect(css).toMatch(/\.gn-v2-tree-table-comment \{[^}]*max-width: 24em;[^}]*text-overflow: ellipsis;/s);
    expect(css).toMatch(/\.gn-v2-tab-hover-tooltip \.ant-tooltip-inner \{[^}]*min-width: 260px;[^}]*padding: 0;/s);
    expect(css).toMatch(/\.gn-v2-tab-hover-card \{[^}]*cursor: text;[^}]*user-select: text;/s);
    expect(css).toContain('--gn-v2-tab-hover-grid-columns: 56px minmax(0, 1fr);');
    expect(css).toMatch(/\.gn-v2-tab-hover-row \{[^}]*grid-template-columns: var\(--gn-v2-tab-hover-grid-columns\);/s);
  });

  it('loads table comments through the sidebar table status metadata query', () => {
    const mysqlSql = buildSidebarTableStatusSQL({ config: { type: 'mysql' } } as any, 'app');
    const pgSql = buildSidebarTableStatusSQL({ config: { type: 'postgres' } } as any, 'app');
    const sqlServerSql = buildSidebarTableStatusSQL({ config: { type: 'sqlserver' } } as any, 'app');
    const oracleSql = buildSidebarTableStatusSQL({ config: { type: 'oracle' } } as any, 'APP');

    expect(mysqlSql).toContain('TABLE_COMMENT AS table_comment');
    expect(mysqlSql).toContain('AS table_size');
    expect(mysqlSql).toContain('CREATE_TIME AS create_time');
    expect(pgSql).toContain("obj_description(c.oid, 'pg_class') AS table_comment");
    expect(pgSql).toContain('pg_total_relation_size(c.oid) AS table_size');
    expect(sqlServerSql).toContain('ep.value AS table_comment');
    expect(sqlServerSql).toContain('t.create_date AS create_time');
    expect(oracleSql).toContain('comments AS table_comment');
    expect(oracleSql).toContain('COALESCE(t.blocks, 0) * 8192 AS table_size');
    expect(oracleSql).toContain('o.last_ddl_time AS update_time');
    expect(oracleSql).not.toContain('all_segments');

    const loaderSource = readSourceFile('./sidebar/useSidebarTreeLoaders.tsx');
    expect(loaderSource).toContain('tableMetadataMap');
    expect(loaderSource).toContain('resolvedMetadata?.tableComment');
    expect(loaderSource).toContain('tableSize: resolvedMetadata?.tableSize');
    expect(loaderSource).toContain('createdAt: resolvedMetadata?.createdAt');
    expect(loaderSource).toContain('updatedAt: resolvedMetadata?.updatedAt');
    expect(loaderSource).toContain('tableSize: entry.tableSize');
    expect(loaderSource).toContain('createdAt: entry.createdAt');
    expect(loaderSource).toContain('updatedAt: entry.updatedAt');
  });

  it('listens for table overview pin changes to refresh the matching sidebar database node', () => {
    const source = readSidebarSource();

    expect(source).toContain("window.addEventListener('gonavi:sidebar-table-pin-changed'");
    expect(source).toContain('findTreeNodeByKeyRef.current(treeDataRef.current, `${connectionId}-${dbName}`)');
    expect(source).toContain('void loadTables(dbNode);');
    expect(source).toContain("window.removeEventListener('gonavi:sidebar-table-pin-changed'");
  });

  it('waits long enough for slow object-tree loads before reporting locate misses', () => {
    const source = readSidebarSource();

    expect(source).toContain('const SIDEBAR_LOCATE_LOAD_WAIT_INTERVAL_MS = 50;');
    expect(source).toContain('const SIDEBAR_LOCATE_LOAD_WAIT_ATTEMPTS = 160;');
    expect(source).toContain('attempt < SIDEBAR_LOCATE_LOAD_WAIT_ATTEMPTS');
    expect(source).toContain('window.setTimeout(resolve, SIDEBAR_LOCATE_LOAD_WAIT_INTERVAL_MS)');
    expect(source).toContain('return !loadingNodesRef.current.has(loadKey);');
    expect(source).toContain("t('sidebar.message.locate_object_loading', {");
  });

  it('resolves sidebar export workbench connection ids from live tree nodes instead of only reading dataRef.connectionId', () => {
    const source = readSidebarSource();

    expect(source).toContain("const connectionId = resolveSidebarNodeConnectionId(node, connectionIds) || String(node?.dataRef?.id || '').trim();");
    expect(source).not.toContain("const connectionId = String(node?.dataRef?.connectionId || '').trim();");
  });
});
