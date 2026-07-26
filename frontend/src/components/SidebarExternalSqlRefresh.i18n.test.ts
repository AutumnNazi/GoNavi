import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './Sidebar.tsx',
  './sidebar/SidebarExternalSqlWorkflow.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

describe('Sidebar external SQL refresh i18n', () => {
  it('localizes global external SQL refresh feedback while preserving raw directory details', () => {
    [
      'SQL 目录读取失败:',
      "message.success('外部 SQL 目录已刷新')",
    ].forEach((snippet) => {
      expect(source).not.toContain(snippet);
    });

    const readFailureKeyUses = source.match(/t\('sidebar\.message\.external_sql_directory_read_failed'/g) || [];
    const refreshedKeyUses = source.match(/t\('sidebar\.message\.external_sql_directory_refreshed'/g) || [];
    expect(readFailureKeyUses.length).toBeGreaterThanOrEqual(1);
    expect(refreshedKeyUses.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('name: directory.name');
    expect(source).toContain('error: directoryRes.message');
  });
});
