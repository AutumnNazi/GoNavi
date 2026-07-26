import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarV2UtilsSource = readFileSync(new URL('./sidebarV2Utils.ts', import.meta.url), 'utf8');
const sidebarHelpersSource = readFileSync(new URL('./sidebar/sidebarHelpers.ts', import.meta.url), 'utf8');

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'connection.sidebar.group.untitled',
  'connection.sidebar.group.badge',
];

describe('Sidebar v2 connection group fallback i18n', () => {
  it('localizes v2 connection group fallback names and badges', () => {
    [
      "name: tag.name || '未命名分组'",
      "fallback = '组'",
    ].forEach((snippet) => {
      expect(sidebarV2UtilsSource).not.toContain(snippet);
      expect(sidebarHelpersSource).not.toContain(snippet);
    });

    expect(sidebarV2UtilsSource).toContain("tag.name || t('connection.sidebar.group.untitled')");
    expect(sidebarHelpersSource).toContain("fallback = t('connection.sidebar.group.badge')");
  });

  it('keeps v2 connection group fallback keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
