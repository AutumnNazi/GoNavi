import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('./sidebar/useSidebarTreeLoaders.tsx', import.meta.url), 'utf8'),
].join('\n');

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.tree.default_schema',
  'sidebar.object_group.tables',
  'sidebar.object_group.views',
  'sidebar.object_group.materialized_views',
  'sidebar.object_group.sequences',
  'sidebar.object_group.routines',
  'sidebar.object_group.packages',
  'sidebar.object_group.triggers',
  'sidebar.object_group.events',
];

const visibilityKeys = [
  'app.settings.sidebar_objects.title',
  'app.settings.sidebar_objects.description',
  'app.settings.sidebar_objects.action.show_all',
  'app.settings.sidebar_objects.action.tables_only',
];

describe('Sidebar object group i18n', () => {
  it('localizes database object group titles and default schema fallback', () => {
    [
      "const schemaTitle = bucket.schemaName || '默认模式'",
      "buildObjectGroup(schemaNodeKey, 'tables', '表'",
      "buildObjectGroup(schemaNodeKey, 'views', '视图'",
      "buildObjectGroup(schemaNodeKey, 'materializedViews', '物化视图'",
      "buildObjectGroup(schemaNodeKey, 'sequences', '序列'",
      "buildObjectGroup(schemaNodeKey, 'routines', '函数'",
      "buildObjectGroup(schemaNodeKey, 'packages', '存储包'",
      "buildObjectGroup(schemaNodeKey, 'triggers', '触发器'",
      "buildObjectGroup(schemaNodeKey, 'events', '事件'",
      "buildObjectGroup(key as string, 'tables', '表'",
      "buildObjectGroup(key as string, 'views', '视图'",
      "buildObjectGroup(key as string, 'materializedViews', '物化视图'",
      "buildObjectGroup(key as string, 'sequences', '序列'",
      "buildObjectGroup(key as string, 'routines', '函数'",
      "buildObjectGroup(key as string, 'packages', '存储包'",
      "buildObjectGroup(key as string, 'triggers', '触发器'",
      "buildObjectGroup(key as string, 'events', '事件'",
    ].forEach((snippet) => {
      expect(source).not.toContain(snippet);
    });

    requiredKeys.forEach((key) => {
      expect(source).toContain(`t('${key}'`);
    });
  });

  it('keeps database object group keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });

  it('localizes the persistent object visibility settings', () => {
    visibilityKeys.forEach((key) => {
      expect(appSource).toContain(`t('${key}'`);
    });
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      visibilityKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
