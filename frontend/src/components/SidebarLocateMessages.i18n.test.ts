import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './Sidebar.tsx',
  './sidebar/useSidebarTreeLoaders.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.message.load_table_list_failed',
  'sidebar.message.locate_external_sql_file_not_found',
  'sidebar.message.locate_connection_not_found_for_object',
  'sidebar.message.locate_connection_not_in_tree',
  'sidebar.message.locate_database_loading',
  'sidebar.message.locate_database_not_found',
  'sidebar.message.locate_object_loading',
  'sidebar.message.locate_object_not_found',
  'sidebar.locate.object.table',
  'sidebar.locate.object.view',
  'sidebar.locate.object.materialized_view',
  'sidebar.locate.object.routine',
  'sidebar.locate.object.trigger',
];

describe('Sidebar locate messages i18n', () => {
  it('localizes locate and load-table user messages', () => {
    [
      "'加载表失败: '",
      'SQL 文件未在外部 SQL 目录中找到',
      '未找到当前表对应的连接',
      "'未在左侧树找到当前连接'",
      '数据库节点仍在加载中',
      '未在左侧树找到数据库',
      '所在数据库对象仍在加载中',
      '未在左侧树中找到',
      "request.objectGroup === 'materializedViews'\r\n          ? '物化视图'",
      ": '表';",
    ].forEach((snippet) => {
      expect(source).not.toContain(snippet);
    });

    requiredKeys.forEach((key) => {
      expect(source).toContain(`t('${key}'`);
    });
  });

  it('keeps locate message keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
