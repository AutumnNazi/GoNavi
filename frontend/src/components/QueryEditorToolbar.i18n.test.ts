import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');

const legacyLiterals = [
  '隐藏结果区',
  '显示结果区',
  '生成 SQL',
  'Text-to-SQL',
  '解释 SQL',
  '优化 SQL',
  'Schema 分析',
  '选择连接',
  '选择数据库',
  '最大返回行数',
  '最大行数：100',
  '最大行数：500',
  '最大行数：1000',
  '最大行数：5000',
  '最大行数：20000',
  '最大行数：不限',
  '运行',
  '停止',
  '保存',
  '更多',
  '美化 SQL',
  '美化',
  '结果',
];

const requiredKeys = [
  'query_editor.placeholder.connection',
  'query_editor.placeholder.database',
  'query_editor.max_rows.tooltip',
  'query_editor.max_rows.option_500',
  'query_editor.max_rows.option_1000',
  'query_editor.max_rows.option_5000',
  'query_editor.max_rows.option_20000',
  'query_editor.max_rows.option_unlimited',
  'query_editor.action.run',
  'query_editor.action.run_with_shortcut',
  'query_editor.action.stop',
  'query_editor.action.save',
  'query_editor.action.save_with_shortcut',
  'query_editor.action.more',
  'query_editor.action.disable_word_wrap',
  'query_editor.action.enable_word_wrap',
  'query_editor.action.word_wrap',
  'query_editor.action.find_in_editor',
  'query_editor.action.find_in_editor_with_shortcut',
  'query_editor.action.format',
  'query_editor.action.format_sql',
  'query_editor.action.format_sql_with_shortcut',
  'query_editor.action.ai_text_to_sql_menu',
  'query_editor.action.ai_explain_sql_menu',
  'query_editor.action.ai_optimize_sql_menu',
  'query_editor.action.ai_schema_analysis',
  'query_editor.action.show_results_panel',
  'query_editor.action.hide_results_panel',
  'query_editor.action.show_results_panel_with_shortcut',
  'query_editor.action.hide_results_panel_with_shortcut',
  'query_editor.action.results',
];

describe('QueryEditorToolbar i18n', () => {
  it('uses localized keys for toolbar chrome', () => {
    expect(source).toContain("import { useOptionalI18n } from '../i18n/provider';");
    expect(source).toContain('const i18n = useOptionalI18n();');
    expect(source).toContain('const t = i18n?.t ?? defaultTranslate;');
    expect(source).toContain("{ label: '100', value: 100 }");

    for (const key of requiredKeys) {
      expect(source).toContain(key);
    }

    for (const literal of legacyLiterals) {
      expect(source).not.toContain(literal);
    }
  });
});
