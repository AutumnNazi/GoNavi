import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TableOverview.tsx', import.meta.url), 'utf8');
const catalogFiles = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'de-DE',
  'ru-RU',
] as const;
const catalogs = Object.fromEntries(catalogFiles.map(language => [
  language,
  JSON.parse(readFileSync(new URL(`../../../shared/i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>,
])) as Record<typeof catalogFiles[number], Record<string, string>>;

const placeholdersOf = (value: string): string[] => (
  Array.from(value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), match => match[1]).sort()
);

const cardSource = source.slice(
  source.indexOf('const renderCardTableContent = (table: TableStatRow) => ('),
  source.indexOf('const renderCardTable = (table: TableStatRow) => {'),
);

const listSource = source.slice(
  source.indexOf('const renderListTable = (table: TableStatRow) => {'),
  source.indexOf('const renderCompactSortHeader = ('),
);

const compactTableSource = source.slice(
  source.indexOf('const renderCompactSortHeader = ('),
  source.indexOf('if (loading) {'),
);

const visibleTableSectionsSource = source.slice(
  source.indexOf('const visibleTableSections = useMemo<OverviewTableSection[]>(() => {'),
  source.indexOf('const v2ContextMenuTable = useMemo('),
);
const normalizedVisibleTableSectionsSource = visibleTableSectionsSource.replace(/\s+/g, ' ').trim();

const renderOverviewSectionTitleSource = source.slice(
  source.indexOf('const renderOverviewSectionTitle = (section: OverviewTableSection) => {'),
  source.indexOf('const renderTableOverviewMetaBadges = useCallback((table: TableStatRow, compact = false) => {'),
);
const metaBadgesSource = source.slice(
  source.indexOf('const renderTableOverviewMetaBadges = useCallback((table: TableStatRow, compact = false) => {'),
  source.indexOf('const renderCardTableContent = (table: TableStatRow) => ('),
);
const normalizedRenderOverviewSectionTitleSource = renderOverviewSectionTitleSource.replace(/\s+/g, ' ').trim();

const toggleOverviewTablePinnedSource = source.slice(
  source.indexOf('const toggleOverviewTablePinned = useCallback((tableName: string, pinned?: boolean) => {'),
  source.indexOf('const handleRenameTable = useCallback((tableName: string) => {'),
);
const normalizedToggleOverviewTablePinnedSource = toggleOverviewTablePinnedSource.replace(/\s+/g, ' ').trim();

const tableOperationSource = source.slice(
  source.indexOf('const loadData = useCallback(async () => {'),
  source.indexOf('const buildMenuItems = useMemo<MenuProps'),
);
const normalizedTableOperationSource = tableOperationSource.replace(/\s+/g, ' ').trim();

const aiPromptSource = source.slice(
  source.indexOf("const injectTablePromptToAI = useCallback(async (tableName: string, promptKind: 'explain' | 'query') => {"),
  source.indexOf('    // --- Theme ---'),
);

const requiredTableOperationKeys = [
  'table_overview.metric.created_at',
  'table_overview.metric.comment',
  'table_overview.metric.updated_at',
  'table_overview.tooltip.table_view',
  'table_overview.tab.design_table_title',
  'table_overview.tab.table_structure_title',
  'table_overview.message.load_tables_failed',
  'table_overview.message.unknown_error',
  'table_overview.message.copy_structure_success',
  'table_overview.message.copy_table_name_empty',
  'table_overview.message.copy_table_name_success',
  'table_overview.message.copy_table_name_failed',
  'table_overview.message.exporting_table_format',
  'table_overview.message.export_success',
  'table_overview.message.export_failed',
  'table_overview.message.delete_table_success',
  'table_overview.message.delete_table_failed',
  'table_overview.message.table_data_action_loading',
  'table_overview.message.table_data_action_success',
  'table_overview.message.table_data_action_failed',
  'table_overview.message.rename_table_success',
  'table_overview.message.rename_table_failed',
  'table_overview.modal.delete_table.title',
  'table_overview.modal.delete_table.content',
  'table_overview.modal.table_data_action.title',
  'table_overview.modal.table_data_action.content',
  'table_overview.modal.rename_table.title',
  'table_overview.modal.rename_table.placeholder',
  'table_overview.validation.table_name_required',
  'table_overview.validation.table_name_unchanged',
  'table_overview.menu.new_query',
  'table_overview.menu.design_table',
  'table_overview.menu.table_structure',
  'table_overview.menu.copy_table_name',
  'table_overview.menu.copy_structure',
  'table_overview.menu.backup_table_sql',
  'table_overview.menu.rename_table',
  'table_overview.menu.danger_operations',
  'table_overview.menu.truncate_table',
  'table_overview.menu.clear_table',
  'table_overview.menu.delete_table',
  'table_overview.menu.export_table_data',
  'table_overview.menu.export_csv',
  'table_overview.menu.export_xlsx',
  'table_overview.menu.export_json',
  'table_overview.menu.export_markdown',
  'table_overview.menu.export_html',
] as const;

const requiredAIPromptKeys = [
  'sidebar.message.ai_table_context_missing',
  'sidebar.ai_prompt.explain.intro',
  'sidebar.ai_prompt.explain.detail',
  'sidebar.ai_prompt.query.intro',
  'sidebar.ai_prompt.query.detail',
] as const;

const requiredRollupKeys = [
  'sidebar.v2_table_menu.new_rollup',
] as const;

describe('TableOverview i18n', () => {
  it('localizes the selected card and list overview copy with existing table_overview keys', () => {
    expect(cardSource).not.toContain('title="行数"');
    expect(cardSource).not.toContain('title="数据大小"');
    expect(cardSource).not.toContain('title="引擎"');
    expect(cardSource).not.toContain('最近修改');
    expect(cardSource).not.toContain('创建时间');
    expect(cardSource).toContain("title={t('table_overview.sort.rows')}");
    expect(cardSource).toContain("title={t('table_overview.metric.data_size')}");
    expect(cardSource).toContain("title={t('table_overview.metric.engine')}");
    expect(cardSource).toContain('{renderTableOverviewMetaBadges(table)}');
    expect(metaBadgesSource).toContain("t('table_overview.metric.updated_at')");
    expect(metaBadgesSource).toContain("t('table_overview.metric.created_at')");

    expect(listSource).not.toContain('`${table.engine} 表`');
    expect(listSource).not.toContain("'双击打开数据，右键查看更多操作'");
    expect(listSource).not.toContain('最近修改');
    expect(listSource).not.toContain('创建时间');
    expect(listSource).not.toContain("<div style={{ color: textMuted }}>行数</div>");
    expect(listSource).not.toContain("<div style={{ color: textMuted }}>数据大小</div>");
    expect(listSource).not.toContain("<div style={{ color: textMuted }}>索引大小</div>");
    expect(listSource).not.toContain("<div style={{ color: textMuted }}>相对大小</div>");
    expect(listSource).toContain("t('table_overview.row.engine_table', { engine: table.engine })");
    expect(listSource).toContain("t('table_overview.row.open_hint')");
    expect(listSource).toContain('{renderTableOverviewMetaBadges(table, true)}');
    expect(listSource).toContain("t('table_overview.sort.rows')");
    expect(listSource).toContain("t('table_overview.metric.data_size')");
    expect(listSource).toContain("t('table_overview.metric.index_size')");
    expect(listSource).toContain("t('table_overview.metric.relative_size')");

    expect(compactTableSource).toContain("renderCompactSortHeader('name', 'table_overview.sort.name')");
    expect(compactTableSource).toContain("renderCompactSortHeader('comment', 'table_overview.metric.comment')");
    expect(compactTableSource).toContain("renderCompactSortHeader('rows', 'table_overview.sort.rows', 'right')");
    expect(compactTableSource).toContain("renderCompactSortHeader('dataSize', 'table_overview.metric.data_size', 'right')");
    expect(compactTableSource).toContain("renderCompactSortHeader('indexSize', 'table_overview.metric.index_size', 'right')");
    expect(compactTableSource).toContain("renderCompactSortHeader('engine', 'table_overview.metric.engine')");
    expect(compactTableSource).toContain("renderCompactSortHeader('updateTime', 'table_overview.metric.updated_at')");
    expect(compactTableSource).toContain("renderCompactSortHeader('createTime', 'table_overview.metric.created_at')");
  });

  it('localizes section titles for pinned and all groups with dedicated table_overview keys', () => {
    expect(visibleTableSectionsSource).not.toContain("title: '全部'");
    expect(visibleTableSectionsSource).not.toContain("title: '置顶'");
    expect(visibleTableSectionsSource).not.toContain("t('table_overview.section.all')");
    expect(visibleTableSectionsSource).not.toContain("t('table_overview.section.pinned')");
    expect(visibleTableSectionsSource).not.toContain('title:');
    expect(normalizedVisibleTableSectionsSource).toContain("return [{ key: 'all', kind: 'all', rows: visibleTables }];");
    expect(normalizedVisibleTableSectionsSource).toContain(
      "{ key: 'pinned', kind: 'pinned' as const, rows: pinnedRows }",
    );
    expect(normalizedVisibleTableSectionsSource).toContain(
      "{ key: 'all', kind: 'all' as const, rows: regularRows }",
    );

    expect(renderOverviewSectionTitleSource).not.toContain("title: '全部'");
    expect(renderOverviewSectionTitleSource).not.toContain("title: '置顶'");
    expect(renderOverviewSectionTitleSource).not.toContain('<span>{section.title}</span>');
    expect(renderOverviewSectionTitleSource).toContain("t('table_overview.section.all')");
    expect(renderOverviewSectionTitleSource).toContain("t('table_overview.section.pinned')");
    expect(normalizedRenderOverviewSectionTitleSource).toContain(
      "const sectionTitle = section.kind === 'pinned' ? t('table_overview.section.pinned') : t('table_overview.section.all');",
    );
  });

  it('localizes toggleOverviewTablePinned success toast without raw pinned copy', () => {
    expect(toggleOverviewTablePinnedSource).not.toContain("'已置顶表'");
    expect(toggleOverviewTablePinnedSource).not.toContain("'已取消置顶'");
    expect(normalizedToggleOverviewTablePinnedSource).toContain(
      "message.success(shouldPin ? t('table_overview.message.pinned') : t('table_overview.message.unpinned'));",
    );
  });

  it('localizes table operation tabs, messages, modals and legacy menu labels', () => {
    [
      '获取表信息失败: ',
      '未知错误',
      '表结构',
      '设计表',
      '新建查询',
      '表结构已复制到剪贴板',
      '表名为空，无法复制',
      '表名已复制到剪贴板',
      '复制表名失败: ',
      '正在导出 ',
      '导出成功',
      '导出失败: ',
      '确认删除表',
      '确定删除表',
      '表删除成功',
      '删除失败: ',
      '确认${label}',
      '操作不可逆',
      '继续',
      '正在${progressLabel}',
      '${progressLabel}成功',
      '${progressLabel}失败',
      '重命名表',
      '输入新表名',
      '表名不能为空',
      '新旧表名相同',
      '表重命名成功',
      '重命名失败: ',
      '复制表名',
      '复制表结构',
      '备份表 (SQL)',
      '危险操作',
      '截断表',
      '清空表',
      '删除表',
      '导出表数据',
      '导出 CSV',
      '导出 Excel (XLSX)',
      '导出 JSON',
      '导出 Markdown',
      '导出 HTML',
    ].forEach(text => {
      expect(tableOperationSource).not.toContain(text);
    });

    [
      'table_overview.tab.design_table_title',
      'table_overview.tab.table_structure_title',
      "t('table_overview.message.copy_structure_failed'",
      "t('table_overview.message.copy_table_name_empty')",
      "t('table_overview.message.copy_table_name_success')",
      "t('table_overview.message.copy_table_name_failed'",
      "t('table_overview.modal.delete_table.title')",
      "t('table_overview.modal.delete_table.content'",
      "t('table_overview.modal.table_data_action.title'",
      "t('table_overview.modal.table_data_action.content'",
      "okText: t('common.continue')",
      "cancelText: t('common.cancel')",
      "t('table_overview.modal.rename_table.title')",
      "t('table_overview.modal.rename_table.placeholder')",
      "t('table_overview.validation.table_name_required')",
      "t('table_overview.validation.table_name_unchanged')",
      "t('table_overview.message.rename_table_success')",
      "t('table_overview.message.rename_table_failed'",
      "t('table_overview.menu.copy_table_name')",
      "t('table_overview.menu.table_structure')",
    ].forEach(text => {
      expect(tableOperationSource).toContain(text);
    });

    expect(tableOperationSource).not.toContain('message.error(res.message);');
    expect(normalizedTableOperationSource).toContain(
      "detail: res.message || t('table_overview.message.unknown_error')",
    );
  });

  it('keeps table operation catalog keys in all supported languages with matching placeholders', () => {
    const zhCnCatalog = catalogs['zh-CN'];
    requiredTableOperationKeys.forEach(key => {
      expect(zhCnCatalog, `zh-CN:${key}`).toHaveProperty(key);
      const expectedPlaceholders = placeholdersOf(zhCnCatalog[key]);
      catalogFiles.forEach(language => {
        expect(catalogs[language], `${language}:${key}`).toHaveProperty(key);
        expect(placeholdersOf(catalogs[language][key]), `${language}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });

  it('localizes AI table prompt shells while keeping table references and DDL raw', () => {
    [
      '当前表缺少连接上下文，无法发送给 AI',
      '请解释数据表 ${dbName}.${tableName} 的结构和业务含义。',
      '重点说明字段含义、主键/索引、潜在关联关系、典型查询场景和风险点。',
      '请基于数据表 ${dbName}.${tableName} 生成 3 条常用查询 SQL。',
      '要求包含：数据预览查询、按关键字段过滤查询、一个聚合或统计查询。',
    ].forEach(text => {
      expect(aiPromptSource).not.toContain(text);
    });

    requiredAIPromptKeys.forEach(key => {
      expect(aiPromptSource).toContain(`t('${key}'`);
    });

    expect(aiPromptSource).toContain('DBShowCreateTable');
    expect(aiPromptSource).toContain('const tableRef = `${dbName}.${tableName}`;');
    expect(aiPromptSource).toContain('ddl ? `\\n\\`\\`\\`sql');
    expect(aiPromptSource).toContain('${ddl}');
  });

  it('keeps reused AI prompt keys in all supported languages with matching placeholders', () => {
    const zhCnCatalog = catalogs['zh-CN'];
    requiredAIPromptKeys.forEach(key => {
      expect(zhCnCatalog, `zh-CN:${key}`).toHaveProperty(key);
      const expectedPlaceholders = placeholdersOf(zhCnCatalog[key]);
      catalogFiles.forEach(language => {
        expect(catalogs[language], `${language}:${key}`).toHaveProperty(key);
        expect(placeholdersOf(catalogs[language][key]), `${language}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });

  it('localizes StarRocks Rollup entry labels while keeping Rollup SQL raw', () => {
    expect(tableOperationSource).not.toContain("title: '新增 Rollup'");
    expect(tableOperationSource).toContain("t('sidebar.v2_table_menu.new_rollup'");
    expect(tableOperationSource).toContain("keyword: 'Rollup'");
    expect(tableOperationSource).toContain('ADD ROLLUP rollup_name (column1, column2);');
  });

  it('keeps reused StarRocks Rollup key in all supported languages with matching placeholders', () => {
    const zhCnCatalog = catalogs['zh-CN'];
    requiredRollupKeys.forEach(key => {
      expect(zhCnCatalog, `zh-CN:${key}`).toHaveProperty(key);
      const expectedPlaceholders = placeholdersOf(zhCnCatalog[key]);
      catalogFiles.forEach(language => {
        expect(catalogs[language], `${language}:${key}`).toHaveProperty(key);
        expect(placeholdersOf(catalogs[language][key]), `${language}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });
});
