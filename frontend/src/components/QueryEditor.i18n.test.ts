import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const queryEditorSource = readFileSync(new URL('./QueryEditor.tsx', import.meta.url), 'utf8');
const queryEditorHelpersSource = readFileSync(new URL('./queryEditor/QueryEditorHelpers.ts', import.meta.url), 'utf8');

describe('QueryEditor i18n source guards', () => {
  it('does not keep legacy builtin SQL function completion details in component source', () => {
    expect(queryEditorSource).not.toContain('const SQL_FUNCTIONS');
    expect(queryEditorSource).not.toContain("detail: '聚合 - 计数'");
    expect(queryEditorSource).not.toContain("detail: '字符串 - 拼接'");
    expect(queryEditorSource).not.toContain("detail: '日期 - 当前日期时间'");
    expect(queryEditorSource).not.toContain("detail: 'JSON - 提取值'");
    expect(queryEditorSource).not.toContain("detail: '窗口 - 行号'");
  });

  it('uses a localized warning for pending managed transactions', () => {
    expect(queryEditorSource).toContain('query_editor.transaction.message.pending_managed_transaction');
    expect(queryEditorSource).not.toContain('当前 SQL 编辑器已有未提交事务，请先提交或回滚后再执行新的增删改语句。');
  });

  it('uses localized labels for SQL format restore chrome', () => {
    expect(queryEditorSource).toContain('query_editor.format.restore_last_format');
    expect(queryEditorSource).toContain('query_editor.message.no_format_restore_snapshot');
    expect(queryEditorSource).toContain('query_editor.message.format_restore_success');
    expect(queryEditorSource).not.toContain('没有可还原的美化前 SQL');
    expect(queryEditorSource).not.toContain('已还原到美化前 SQL');
    expect(queryEditorSource).not.toContain('还原上次美化');
  });

  it('uses localized wrappers for result pagination feedback', () => {
    expect(queryEditorSource).toContain('query_editor.message.page_query_failed');
    expect(queryEditorSource).toContain('query_editor.message.page_query_empty');
    expect(queryEditorSource).not.toContain('翻页失败: ');
    expect(queryEditorSource).not.toContain('翻页未返回结果集');
  });

  it('routes editor search through a localized Monaco action', () => {
    expect(queryEditorSource).toContain('query_editor.action.find_in_editor');
    expect(queryEditorSource).toContain('gonavi:find-active-query');
    expect(queryEditorSource).toContain("editor.getAction?.('actions.find')");
    expect(queryEditorSource).toContain('addExtraSpaceOnTop: false');
  });

  it('uses a localized wrapper for save query failures', () => {
    expect(queryEditorSource).toContain('query_editor.message.save_query_failed');
    expect(queryEditorSource).not.toContain('保存查询失败: ');
  });

  it('uses a localized AI diagnosis prompt wrapper', () => {
    expect(queryEditorSource).toContain('query_editor.ai_prompt.diagnose');
    expect(queryEditorSource).not.toContain('我在执行以下 SQL 时遇到了错误');
    expect(queryEditorSource).not.toContain('数据库报错信息如下');
    expect(queryEditorSource).not.toContain('请帮我分析错误原因，并给出修改建议。');
  });

  it('uses a localized read-only reason for system metadata query results', () => {
    expect(queryEditorHelpersSource).toContain('query_editor.message.read_only_system_metadata');
    expect(queryEditorHelpersSource).not.toContain('系统元数据查询结果保持只读。');
  });

  it('does not keep the index metadata internal fallback in Chinese', () => {
    expect(queryEditorHelpersSource).toContain('Failed to load indexes');
    expect(queryEditorHelpersSource).not.toContain('加载索引失败');
  });
});
