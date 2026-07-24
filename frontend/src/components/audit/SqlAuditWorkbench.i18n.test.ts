import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const catalogs = Object.fromEntries(locales.map((locale) => [
  locale,
  JSON.parse(readFileSync(new URL(`../../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>,
])) as Record<typeof locales[number], Record<string, string>>;

const placeholdersOf = (value: string): string[] => (
  Array.from(value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (match) => match[1]).sort()
);

describe('SQL audit workbench i18n', () => {
  it('keeps every SQL audit key and placeholder set aligned in all six catalogs', () => {
    const keys = Object.keys(catalogs['en-US']).filter((key) => (
      key.startsWith('sql_audit.')
      || key === 'app.tools.entry.sql_audit.title'
      || key === 'app.tools.entry.sql_audit.description'
      || key === 'tab_manager.kind_badge.sql_audit'
      || key === 'tab_manager.hover.kind.sql_audit'
    ));

    expect(keys.length).toBeGreaterThan(100);
    keys.forEach((key) => {
      const expectedPlaceholders = placeholdersOf(catalogs['en-US'][key]);
      locales.forEach((locale) => {
        expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
        expect(placeholdersOf(catalogs[locale][key]), `${locale}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });

  it('states the redacted/metadata-only privacy boundary in every language', () => {
    locales.forEach((locale) => {
      expect(catalogs[locale]['sql_audit.privacy.description']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.settings.capture_mode.redacted']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.settings.capture_mode.metadata']).toBeTruthy();
      expect(catalogs[locale]).not.toHaveProperty('sql_audit.settings.capture_mode.raw');
      expect(catalogs[locale]).not.toHaveProperty('sql_audit.settings.capture_mode.full');
    });
  });

  it('labels writer gaps separately from tamper-proof integrity claims', () => {
    locales.forEach((locale) => {
      expect(catalogs[locale]['sql_audit.event_type.query_statement']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.event_type.audit_gap']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.health.degraded.description']).toContain('{{count}}');
      expect(catalogs[locale]['sql_audit.health.recovered.description']).toContain('audit_gap');
      expect(catalogs[locale]['sql_audit.health.disabled.title']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.health.disabled.description']).toBeTruthy();
      expect(catalogs[locale]['sql_audit.health.capture_mode']).toBeTruthy();
    });
    expect(catalogs['en-US']['sql_audit.health.healthy.description']).toContain('not a tamper-proof guarantee');
  });
});
