import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar create routine DuckDB template i18n', () => {
  it('localizes DuckDB procedure fallback comments without translating SQL Macro DDL', () => {
    expect(source).not.toContain('-- DuckDB 暂不支持存储过程');
    expect(source).not.toContain('-- 请使用 SQL Macro 作为函数能力');
    expect(source).toContain("t('sidebar.sql_template.duckdb_procedure_unsupported')");
    expect(source).toContain("t('sidebar.sql_template.duckdb_macro_hint')");
    expect(source).toContain('CREATE MACRO func_name(param1) AS (param1 * 2);');
  });

  it('keeps DuckDB fallback catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.sql_template.duckdb_procedure_unsupported'], `${locale}:duckdb procedure unsupported`).toBeTruthy();
      expect(catalog['sidebar.sql_template.duckdb_macro_hint'], `${locale}:duckdb macro hint`).toBeTruthy();
    });
  });
});
