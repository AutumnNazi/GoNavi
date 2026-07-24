import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const objectActionsSource = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const legacyMenuSource = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');
const tableDataDangerActionsSource = readFileSync(new URL('./tableDataDangerActions.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

const requiredKeys = [
  'sidebar.message.schema_edit_unsupported',
  'sidebar.message.schema_target_edit_missing',
  'sidebar.message.schema_name_unchanged',
  'sidebar.message.schema_renamed',
  'sidebar.message.schema_target_delete_missing',
  'sidebar.message.schema_deleted',
  'sidebar.message.table_export_target_missing',
  'sidebar.modal.confirm_delete_schema.title',
  'sidebar.modal.confirm_delete_schema.content',
  'sidebar.menu.edit_schema',
  'sidebar.menu.export_current_schema_sql',
  'sidebar.menu.backup_current_schema_sql',
  'sidebar.menu.delete_schema',
  'sidebar.menu.copy_object_name',
  'sidebar.menu.table_structure',
  'sidebar.menu.design_table',
  'sidebar.menu.copy_table_name',
  'sidebar.menu.copy_database_name',
  'sidebar.copy_object_name.label.database',
  'sidebar.menu.copy_table_structure',
  'sidebar.menu.backup_table_sql',
  'sidebar.menu.rename_table',
  'sidebar.menu.truncate_table',
  'sidebar.menu.clear_table',
  'sidebar.menu.delete_table',
  'sidebar.menu.export_table_data',
  'sidebar.v2_table_menu.new_rollup',
  'sidebar.message.table_name_required',
  'sidebar.message.table_name_unchanged',
  'sidebar.message.table_renamed',
  'sidebar.message.table_deleted',
  'sidebar.modal.confirm_delete_table.title',
  'sidebar.modal.confirm_delete_table.content',
  'sidebar.message.view_name_required',
  'sidebar.message.view_name_unchanged',
  'sidebar.message.view_renamed',
  'sidebar.message.view_deleted',
  'sidebar.modal.confirm_delete_view.title',
  'sidebar.modal.confirm_delete_view.content',
  'sidebar.message.rename_failed',
  'sidebar.message.delete_failed',
  'sidebar.message.table_data_action_loading',
  'sidebar.message.table_data_action_success',
  'sidebar.message.table_data_action_failed',
  'sidebar.modal.confirm_table_data_action.title',
  'sidebar.modal.confirm_table_data_action.content',
  'sidebar.table_action.truncate.label',
  'sidebar.table_action.truncate.progress',
  'sidebar.table_action.clear.label',
  'sidebar.table_action.clear.progress',
] as const;

describe('Sidebar object actions i18n', () => {
  it('localizes schema, table, and view object action copy', () => {
    [
      '当前节点不支持通过此入口编辑模式',
      '未找到目标模式，无法编辑',
      '新旧模式名称相同，无需修改',
      '模式重命名成功',
      '编辑失败: ',
      '未找到目标模式，无法删除',
      '确认删除模式',
      '确定删除模式',
      '模式删除成功',
      '删除失败: ',
      '未识别到表名，无法导出',
      '新增 Rollup',
      '表名不能为空',
      '新旧表名相同，无需修改',
      '表重命名成功',
      '确认删除表',
      '确定删除表',
      '表删除成功',
      '确认${label}',
      '${label}会永久删除表',
      '正在${progressLabel}',
      '${progressLabel}成功',
      '${progressLabel}失败',
      '视图名称不能为空',
      '新旧视图名相同，无需修改',
      '视图重命名成功',
      '确认删除视图',
      '确定删除视图',
      '视图删除成功',
    ].forEach((rawSnippet) => {
      expect(objectActionsSource).not.toContain(rawSnippet);
    });

    [
      "label: '编辑模式'",
      "label: '导出当前模式表结构 (SQL)'",
      "label: '备份当前模式全部表 (结构+数据 SQL)'",
      "label: '删除模式'",
      "label: '复制名称'",
      "label: '测试发送消息'",
      "label: '表结构'",
      "label: '设计表'",
      "label: '复制表名'",
      "label: '复制表结构'",
      "label: '备份表 (SQL)'",
      "label: '重命名表'",
      "label: '截断表'",
      "label: '清空表'",
      "label: '删除表'",
      "label: '导出表数据'",
    ].forEach((rawSnippet) => {
      expect(legacyMenuSource).not.toContain(rawSnippet);
    });

    [
      "t('sidebar.message.schema_edit_unsupported')",
      "t('sidebar.message.schema_target_edit_missing')",
      "t('sidebar.message.schema_name_unchanged')",
      "t('sidebar.message.schema_renamed')",
      "t('sidebar.message.schema_target_delete_missing')",
      "t('sidebar.message.table_export_target_missing')",
      "t('sidebar.message.schema_deleted')",
      "t('sidebar.v2_table_menu.new_rollup'",
      "t('sidebar.modal.confirm_delete_schema.title')",
      "t('sidebar.modal.confirm_delete_schema.content'",
      "t('sidebar.message.table_name_required')",
      "t('sidebar.message.table_name_unchanged')",
      "t('sidebar.message.table_renamed')",
      "t('sidebar.message.table_deleted')",
      "t('sidebar.modal.confirm_delete_table.title')",
      "t('sidebar.modal.confirm_delete_table.content'",
      "t('sidebar.message.view_name_required')",
      "t('sidebar.message.view_name_unchanged')",
      "t('sidebar.message.view_renamed')",
      "t('sidebar.message.view_deleted')",
      "t('sidebar.modal.confirm_delete_view.title')",
      "t('sidebar.modal.confirm_delete_view.content'",
      "t('sidebar.message.rename_failed'",
      "t('sidebar.message.delete_failed'",
      "t('sidebar.message.table_data_action_loading'",
      "t('sidebar.message.table_data_action_success'",
      "t('sidebar.message.table_data_action_failed'",
      "t('sidebar.modal.confirm_table_data_action.title'",
      "t('sidebar.modal.confirm_table_data_action.content'",
    ].forEach((lookup) => {
      expect(objectActionsSource).toContain(lookup);
    });

    [
      "t('sidebar.menu.edit_schema')",
      "t('sidebar.menu.export_current_schema_sql')",
      "t('sidebar.menu.backup_current_schema_sql')",
      "t('sidebar.menu.delete_schema')",
      "t('sidebar.menu.copy_object_name')",
      "t('message_publish_modal.title')",
      "t('sidebar.menu.table_structure')",
      "t('sidebar.menu.design_table')",
      "t('sidebar.menu.copy_table_name')",
      "t('sidebar.menu.copy_database_name')",
      "t('sidebar.menu.copy_table_structure')",
      "t('sidebar.menu.backup_table_sql')",
      "t('sidebar.menu.rename_table')",
      "t('sidebar.menu.truncate_table')",
      "t('sidebar.menu.clear_table')",
      "t('sidebar.menu.delete_table')",
      "t('sidebar.menu.export_table_data')",
    ].forEach((lookup) => {
      expect(legacyMenuSource).toContain(lookup);
    });
  });

  it('localizes table data danger action metadata', () => {
    expect(tableDataDangerActionsSource).not.toContain("return { label: '截断表', progressLabel: '截断' };");
    expect(tableDataDangerActionsSource).not.toContain("return { label: '清空表', progressLabel: '清空' };");
    expect(tableDataDangerActionsSource).toContain("'sidebar.table_action.truncate.label'");
    expect(tableDataDangerActionsSource).toContain("'sidebar.table_action.truncate.progress'");
    expect(tableDataDangerActionsSource).toContain("'sidebar.table_action.clear.label'");
    expect(tableDataDangerActionsSource).toContain("'sidebar.table_action.clear.progress'");
  });

  it('keeps object action catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
