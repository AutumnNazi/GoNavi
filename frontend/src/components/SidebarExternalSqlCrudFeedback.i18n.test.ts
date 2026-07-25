import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/SidebarExternalSqlWorkflow.tsx', import.meta.url), 'utf8');

const externalSqlCrudBlock = source.slice(
  source.indexOf('const openCreateExternalSQLFileModal ='),
  source.indexOf('const handleDeleteExternalSQLFile ='),
);

describe('Sidebar external SQL create and rename feedback i18n', () => {
  it('localizes create and rename file or directory feedback while keeping names and backend details raw', () => {
    [
      '未找到可新建 SQL 文件的目录',
      '未找到可重命名的 SQL 文件',
      '未找到可新建目录的位置',
      '未找到可重命名的目录',
      '目录名不能为空',
      'SQL 文件名不能为空',
      '新建 SQL 文件失败: ',
      'SQL 文件已新建',
      '重命名 SQL 文件失败: ',
      'SQL 文件已重命名',
      '新建目录失败: ',
      '目录已新建',
      '重命名目录失败: ',
      '目录已重命名，但无法同步外部 SQL 目录列表，请重新添加目录',
      'SQL目录',
      '目录已重命名',
    ].forEach((snippet) => {
      expect(externalSqlCrudBlock).not.toContain(snippet);
    });

    [
      'sidebar.message.external_sql_file_parent_missing',
      'sidebar.message.external_sql_file_rename_target_missing',
      'sidebar.message.external_sql_directory_parent_missing',
      'sidebar.message.external_sql_directory_rename_target_missing',
      'sidebar.message.sql_file_name_required',
      'sidebar.message.sql_directory_name_required',
      'sidebar.message.create_sql_file_failed',
      'sidebar.message.sql_file_created',
      'sidebar.message.rename_sql_file_failed',
      'sidebar.message.sql_file_renamed',
      'sidebar.message.create_sql_directory_failed',
      'sidebar.message.sql_directory_created',
      'sidebar.message.rename_sql_directory_failed',
      'sidebar.message.external_sql_directory_rename_sync_failed',
      'sidebar.message.sql_directory_renamed',
      'sidebar.sql_directory.default_name',
    ].forEach((key) => {
      expect(externalSqlCrudBlock).toContain(key);
    });

    expect(externalSqlCrudBlock).toContain('error: res.message');
    expect(externalSqlCrudBlock).toContain('nextName || nextPath.split');
  });
});
