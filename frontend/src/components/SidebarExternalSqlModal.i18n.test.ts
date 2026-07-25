import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/SidebarExternalSqlWorkflow.tsx', import.meta.url), 'utf8');
const modalStart = source.indexOf('export const ExternalSQLFileModal');
const modalEnd = source.indexOf('export const SQLFileExecutionModal');
const externalSqlModalBlock = source.slice(modalStart, modalEnd);

describe('Sidebar external SQL file modal i18n', () => {
  it('localizes external SQL create and rename modal chrome without translating names or paths', () => {
    [
      "'新建 SQL 文件'",
      "'重命名 SQL 文件'",
      "'新建目录'",
      "'重命名目录'",
      "? '新建' : '重命名'",
      'cancelText="取消"',
      "? '目录名' : 'SQL 文件名'",
      "'请输入目录名'",
      "'请输入 SQL 文件名'",
      "'目录名不能包含路径分隔符'",
      "'文件名不能包含路径分隔符'",
      "'目录只会显示在外部 SQL 目录树中，非 SQL 文件仍不会显示'",
      "'不输入 .sql 后缀时会自动补齐'",
      "'例如：reports'",
      "'例如：report.sql'",
    ].forEach((snippet) => {
      expect(externalSqlModalBlock).not.toContain(snippet);
    });

    [
      'sidebar.external_sql_modal.title.create_file',
      'sidebar.external_sql_modal.title.rename_file',
      'sidebar.external_sql_modal.title.create_directory',
      'sidebar.external_sql_modal.title.rename_directory',
      'sidebar.external_sql_modal.action.create',
      'sidebar.external_sql_modal.action.rename',
      'common.cancel',
      'sidebar.external_sql_modal.field.directory_name',
      'sidebar.external_sql_modal.field.sql_file_name',
      'sidebar.external_sql_modal.validation.directory_name_required',
      'sidebar.external_sql_modal.validation.sql_file_name_required',
      'sidebar.external_sql_modal.validation.directory_name_no_separator',
      'sidebar.external_sql_modal.validation.sql_file_name_no_separator',
      'sidebar.external_sql_modal.help.directory',
      'sidebar.external_sql_modal.help.sql_file',
      'sidebar.external_sql_modal.placeholder.directory_name',
      'sidebar.external_sql_modal.placeholder.sql_file_name',
    ].forEach((key) => {
      expect(externalSqlModalBlock).toContain(key);
    });
  });
});
