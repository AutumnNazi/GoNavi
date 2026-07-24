import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8'),
].join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

const requiredKeys = [
  'sidebar.copy_object_name.label.database',
  'sidebar.copy_object_name.label.table',
  'sidebar.copy_object_name.label.view',
  'sidebar.copy_object_name.label.materialized_view',
  'sidebar.copy_object_name.label.sequence',
  'sidebar.copy_object_name.label.package',
  'sidebar.copy_object_name.label.event',
  'sidebar.copy_object_name.empty',
  'sidebar.copy_object_name.copied',
  'sidebar.copy_object_name.failed',
] as const;

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe('Sidebar copy object name i18n', () => {
  it('localizes copy object name labels and feedback messages', () => {
    expect(source).not.toContain("return '视图名称'");
    expect(source).not.toContain("return '物化视图名称'");
    expect(source).not.toContain("return '事件名称'");
    expect(source).not.toContain("return '表名'");
    expect(source).not.toContain('`${label}为空，无法复制`');
    expect(source).not.toContain('`${label}已复制到剪贴板`');
    expect(source).not.toContain('`复制${label}失败: `');
    expect(source).toContain("t('sidebar.copy_object_name.label.database')");
    expect(source).toContain("t('sidebar.copy_object_name.label.view')");
    expect(source).toContain("t('sidebar.copy_object_name.label.materialized_view')");
    expect(source).toContain("t('sidebar.copy_object_name.label.sequence')");
    expect(source).toContain("t('sidebar.copy_object_name.label.package')");
    expect(source).toContain("t('sidebar.copy_object_name.label.event')");
    expect(source).toContain("t('sidebar.copy_object_name.label.table')");
    expect(source).toContain("t('sidebar.copy_object_name.empty'");
    expect(source).toContain("t('sidebar.copy_object_name.copied'");
    expect(source).toContain("t('sidebar.copy_object_name.failed'");
  });

  it('keeps copy object name catalog entries available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['sidebar.copy_object_name.empty'])).toEqual(['label']);
      expect(placeholders(catalog['sidebar.copy_object_name.copied'])).toEqual(['label']);
      expect(placeholders(catalog['sidebar.copy_object_name.failed'])).toEqual(['error', 'label']);
    });
  });
});
