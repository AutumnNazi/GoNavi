import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dataGridSource = readFileSync(new URL('./DataGridShell.tsx', import.meta.url), 'utf8');

describe('DataGrid embedded designer title i18n guards', () => {
  it('localizes the embedded table designer tab title while preserving the raw table name parameter', () => {
    expect(dataGridSource).toContain("translateDataGrid('data_grid.embedded_designer.title'");
    expect(dataGridSource).toContain('tableName: tableName ||');
    expect(dataGridSource).not.toContain('title: `设计表 (${tableName || \'\'}');
  });

  it('keeps the embedded designer title key in every locale catalog with the tableName placeholder', () => {
    (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const).forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      expect(catalog['data_grid.embedded_designer.title']).toEqual(expect.any(String));
      expect(catalog['data_grid.embedded_designer.title']).toContain('{{tableName}}');
    });
  });
});
