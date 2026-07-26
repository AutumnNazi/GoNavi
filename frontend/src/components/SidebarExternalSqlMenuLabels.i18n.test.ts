import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');
const externalSqlMenuStart = source.indexOf("if (node.type === 'external-sql-root')");
const externalSqlMenuEnd = source.indexOf('    return [];', externalSqlMenuStart);

const externalSqlMenuBlock = source.slice(
  externalSqlMenuStart,
  externalSqlMenuEnd,
);

describe('Sidebar external SQL menu labels i18n', () => {
  it('localizes external SQL tree menu labels without changing node actions', () => {
    [
      "label: '新建 SQL 文件'",
      "label: '新建目录'",
      "label: '重命名目录'",
      "label: '刷新目录'",
      "label: '删除本地目录'",
      "label: '删除目录'",
      "label: '重命名 SQL 文件'",
      "label: '在此目录新建 SQL 文件'",
      "label: '在此目录新建目录'",
      "label: '删除 SQL 文件'",
    ].forEach((snippet) => {
      expect(externalSqlMenuBlock).not.toContain(snippet);
    });

    [
      'sidebar.menu.add_sql_directory',
      'sidebar.menu.new_sql_file',
      'sidebar.menu.new_sql_directory',
      'sidebar.menu.rename_sql_directory',
      'sidebar.menu.refresh_directory',
      'sidebar.menu.remove_directory',
      'sidebar.menu.delete_local_directory',
      'sidebar.menu.delete_sql_directory',
      'sidebar.menu.open_sql_file',
      'sidebar.menu.rename_sql_file',
      'sidebar.menu.new_sql_file_in_directory',
      'sidebar.menu.new_sql_directory_in_directory',
      'sidebar.menu.delete_sql_file',
    ].forEach((key) => {
      expect(externalSqlMenuBlock).toContain(key);
    });

    [
      'openCreateExternalSQLFileModal(node)',
      'openCreateExternalSQLDirectoryModal(node)',
      'openRenameExternalSQLDirectoryModal(node)',
      'handleRefreshExternalSQLDirectory(node)',
      'handleRemoveExternalSQLDirectory(node)',
      'handleDeleteExternalSQLDirectory(node)',
      'openRenameExternalSQLFileModal(node)',
      'openExternalSQLFile(node)',
      'handleDeleteExternalSQLFile(node)',
    ].forEach((action) => {
      expect(externalSqlMenuBlock).toContain(action);
    });
  });
});
