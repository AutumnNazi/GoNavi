import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSourceFile = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const source = [
  readSourceFile('./Sidebar.tsx'),
  readSourceFile('./sidebar/SidebarSearchPanel.tsx'),
  readSourceFile('./sidebar/useSidebarSearchModel.tsx'),
  readSourceFile('./sidebar/useSidebarCommandSearchRunner.ts'),
].join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.command_search.recent_sql_fallback',
  'sidebar.command_search.action.new_query.meta',
  'sidebar.command_search.action.new_connection.title',
  'sidebar.command_search.action.new_connection.meta',
  'sidebar.command_search.action.open_ai.title',
  'sidebar.command_search.action.open_ai.meta',
  'sidebar.command_search.action.open_sql_log.title',
  'sidebar.command_search.action.open_sql_log.meta',
  'sidebar.command_search.action.clear_recent',
  'sidebar.command_search.action.remove_recent',
  'sidebar.command_search.empty.ai',
  'sidebar.command_search.empty.object',
  'sidebar.command_search.empty.default',
  'sidebar.command_search.section.goto',
  'sidebar.command_search.section.ai',
  'sidebar.command_search.section.actions',
  'sidebar.command_search.section.recent',
  'sidebar.command_search.footer.navigate',
  'sidebar.command_search.footer.select',
  'sidebar.command_search.footer.object_only',
  'sidebar.command_search.footer.ask_ai',
  'sidebar.tab.recent_query',
];

describe('Sidebar command search i18n', () => {
  it('localizes v2 command search chrome without translating raw SQL or object values', () => {
    [
      "'SQL 记录'",
      "title: '最近查询'",
      "meta: '打开一个新的 SQL 编辑页'",
      "title: '新建数据源'",
      "meta: '创建数据库、运行时或其他数据源连接'",
      "title: '打开 AI 数据洞察'",
      "meta: '让 AI 分析当前数据库上下文'",
      "title: '查看 SQL 执行日志'",
      "meta: '打开最近执行记录面板'",
      '输入「?」后加问题，按 Enter 发送到 AI 面板。',
      '未找到匹配的表、视图或物化视图。',
      '未找到匹配项。可输入 @表名 只搜表对象，或输入 ?问题 让 AI 回答。',
      "'跳转 · GO TO'",
      "'AI · ASK'",
      "'动作 · ACTIONS'",
      "'近期查询 · RECENT'",
      '导航</span>',
      '选择</span>',
      '只搜表对象</span>',
      '发送给 AI</span>',
    ].forEach((legacyCopy) => {
      expect(source).not.toContain(legacyCopy);
    });

    requiredKeys.forEach((key) => {
      expect(source).toContain(`t('${key}'`);
    });

    expect(source).toContain('log.sql.replace');
    expect(source).toContain('item.sql');
    expect(source).toContain('dataRef.tableName || dataRef.viewName');
  });

  it('keeps command search keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
