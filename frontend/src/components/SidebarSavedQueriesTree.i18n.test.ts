import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.tree.untitled_query',
  'sidebar.tree.default_database',
  'sidebar.tree.unknown_connection',
  'sidebar.tree.unmatched_saved_queries',
  'sidebar.tree.all_saved_queries',
  'sidebar.tree.ungrouped_saved_queries',
  'sidebar.saved_query_group.create_title',
  'sidebar.saved_query_group.edit_title',
  'sidebar.saved_query_group.new_group',
  'sidebar.saved_query_group.new_subgroup',
  'sidebar.saved_query_group.move_to_group',
  'sidebar.saved_query_group.move_to_ungrouped',
  'sidebar.saved_query_group.empty_queries',
  'sidebar.message.saved_query_group_created',
  'sidebar.message.saved_query_group_delete_failed',
  'sidebar.message.saved_query_group_move_failed',
  'sidebar.message.saved_query_group_save_failed',
  'sidebar.saved_query_group.error.backend_unavailable',
  'sidebar.saved_query_group.error.invalid_input',
];

describe('Sidebar saved queries tree i18n', () => {
  it('localizes saved query fallback tree titles', () => {
    [
      "title: query.name || '未命名查询'",
      "|| '默认数据库'",
      "|| '未知连接'",
      "title: '未匹配'",
      "title: '全部已存查询'",
    ].forEach((snippet) => {
      expect(source).not.toContain(snippet);
    });

    expect(source).toContain("query.name || t('sidebar.tree.untitled_query')");
    expect(source).toContain("t('sidebar.tree.default_database')");
    expect(source).toContain("t('sidebar.tree.unknown_connection')");
    expect(source).toContain("title: t('sidebar.tree.unmatched_saved_queries')");
    expect(source).toContain("title: t('sidebar.tree.all_saved_queries')");
    expect(source).toContain("title: t('sidebar.tree.ungrouped_saved_queries')");
  });

  it('keeps saved query fallback keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
