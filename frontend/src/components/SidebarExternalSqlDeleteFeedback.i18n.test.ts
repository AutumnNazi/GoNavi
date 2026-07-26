import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/SidebarExternalSqlWorkflow.tsx', import.meta.url), 'utf8');

const externalSqlDeleteBlock = source.slice(
  source.indexOf('const handleDeleteExternalSQLFile ='),
  source.indexOf('const handleAddExternalSQLDirectory ='),
);

describe('Sidebar external SQL delete feedback i18n', () => {
  it('localizes file and directory delete feedback while keeping names and backend details raw', () => {
    [
      'SQL 文件',
      '未找到可删除的 SQL 文件',
      '确认删除 SQL 文件',
      '该操作会删除本地磁盘文件，无法恢复。',
      '删除 SQL 文件失败: ',
      'SQL 文件已删除',
      '目录',
      '未找到可删除的目录',
      '确认删除目录',
      '该操作会删除本地磁盘目录，且仅支持删除空目录。',
      '删除目录失败: ',
      '目录已删除',
    ].forEach((snippet) => {
      expect(externalSqlDeleteBlock).not.toContain(snippet);
    });

    [
      'sidebar.sql_file.default_name',
      'sidebar.message.external_sql_file_delete_target_missing',
      'sidebar.modal.confirm_delete_sql_file.title',
      'sidebar.modal.confirm_delete_sql_file.content',
      'sidebar.message.delete_sql_file_failed',
      'sidebar.message.sql_file_deleted',
      'sidebar.sql_directory.default_name',
      'sidebar.message.external_sql_directory_delete_target_missing',
      'sidebar.modal.confirm_delete_sql_directory.title',
      'sidebar.modal.confirm_delete_sql_directory.content',
      'sidebar.message.delete_sql_directory_failed',
      'sidebar.message.sql_directory_deleted',
    ].forEach((key) => {
      expect(externalSqlDeleteBlock).toContain(key);
    });

    expect(externalSqlDeleteBlock).toContain('name: fileName');
    expect(externalSqlDeleteBlock).toContain('name: directoryName');
    expect(externalSqlDeleteBlock).toContain('error: res.message');
    expect(externalSqlDeleteBlock).toContain('DeleteSQLFile(filePath)');
    expect(externalSqlDeleteBlock).toContain('DeleteSQLDirectory(directoryPath)');
  });
});
