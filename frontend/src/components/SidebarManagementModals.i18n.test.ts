import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = [
  './Sidebar.tsx',
  './sidebar/SidebarEntityModals.tsx',
  '../App.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

const requiredKeys = [
  'sidebar.action.new_group',
  'sidebar.action.locate_current_tab',
  'sidebar.message.locate_current_tab_unavailable',
  'app.sidebar.sql_execution_log',
  'sidebar.modal.create_database.title',
  'sidebar.field.database_name',
  'sidebar.validation.name_required',
  'sidebar.modal.rename_schema.title',
  'sidebar.field.schema_name',
  'sidebar.validation.schema_name_required',
  'sidebar.modal.rename_table.title',
  'sidebar.field.new_table_name',
  'sidebar.validation.new_table_name_required',
  'sidebar.modal.rename_view.title',
  'sidebar.field.new_view_name',
  'sidebar.validation.new_view_name_required',
] as const;

describe('Sidebar management modals i18n', () => {
  it('localizes legacy toolbar and management modal copy', () => {
    [
      'title="新建数据库"',
      'label="数据库名称"',
      "message: '请输入名称'",
      'title="新建组"',
      'aria-label="新建组"',
      '定位当前标签页',
      '当前标签页没有可定位的内容',
      'SQL 执行日志',
      '编辑模式${',
      'label="模式名称"',
      "message: '请输入模式名称'",
      '重命名表${',
      'label="新表名"',
      "message: '请输入新表名'",
      '重命名视图${',
      'label="新视图名"',
      "message: '请输入新视图名'",
    ].forEach((rawSnippet) => {
      expect(sidebarSource).not.toContain(rawSnippet);
    });

    requiredKeys.forEach((key) => {
      expect(sidebarSource, key).toContain(`t('${key}'`);
    });
  });

  it('keeps management modal catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
