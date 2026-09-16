import { describe, expect, it } from 'vitest';

import {
  buildQueryEditorResultBudgetOptions,
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

  it('keeps the unlimited option behind a documented process safety cap', () => {
    expect(buildQueryEditorResultBudgetOptions(0)).toEqual({
      maxRowsPerResult: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
      maxTotalRows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
      maxTotalBytes: QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
      maxFieldBytes: QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
    });
  });
});
