import { describe, expect, it } from 'vitest';

import {
  buildQueryEditorResultBudgetOptions,
  QUERY_EDITOR_BUDGET_UNLIMITED,
  QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
  QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
  QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
} from './queryEditorResultBudget';

describe('query editor result budget', () => {
  it('maps a configured row limit to both per-result and total scan limits', () => {
    expect(buildQueryEditorResultBudgetOptions(5_000)).toEqual({
      maxRowsPerResult: 5_000,
      maxTotalRows: 5_000,
      maxTotalBytes: QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
      maxFieldBytes: QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
    });
  });

  it('clamps a configured row limit to the safe ceiling', () => {
    expect(buildQueryEditorResultBudgetOptions(QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS + 1)).toEqual({
      maxRowsPerResult: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
      maxTotalRows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
      maxTotalBytes: QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
      maxFieldBytes: QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
    });
  });

  // 哨兵值必须是负数：后端四个字段都带 omitempty，0 与「字段缺省」在 JSON 上
  // 不可区分，用 0 会让漏传字段的调用方静默变成无上限。
  it('sends the negative unlimited sentinel for rows and total bytes', () => {
    expect(buildQueryEditorResultBudgetOptions(0)).toEqual({
      maxRowsPerResult: QUERY_EDITOR_BUDGET_UNLIMITED,
      maxTotalRows: QUERY_EDITOR_BUDGET_UNLIMITED,
      maxTotalBytes: QUERY_EDITOR_BUDGET_UNLIMITED,
      maxFieldBytes: QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
    });
    expect(QUERY_EDITOR_BUDGET_UNLIMITED).toBeLessThan(0);
  });

  // 单字段上限永不放开：放开它会让 Oracle 文本大对象退化成 4KiB 兜底预览，
  // 也会让扫描预算整体变成「无预算」而丢掉截断标记。
  it('keeps the per-field preview cap under the unlimited option', () => {
    for (const configured of [0, undefined, null, -1, Number.NaN]) {
      expect(buildQueryEditorResultBudgetOptions(configured).maxFieldBytes)
        .toBe(QUERY_EDITOR_SAFE_MAX_FIELD_BYTES);
    }
  });
});
