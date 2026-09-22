import { describe, expect, it } from 'vitest';

import {
  applyQueryEditorResultHistoryBudget,
  canPinQueryEditorResult,
  estimateQueryEditorResultSetBytes,
  QUERY_EDITOR_PINNED_RESULT_MAX_RESULTS,
  QUERY_EDITOR_RESULT_HISTORY_MAX_BYTES,
  QUERY_EDITOR_RESULT_HISTORY_MAX_RESULTS,
  QUERY_EDITOR_RESULT_HISTORY_MAX_ROWS,
  type QueryEditorResultHistoryEntry,
} from './queryEditorResultHistory';

const buildResult = (
  key: string,
  rowCount: number,
  overrides: Partial<QueryEditorResultHistoryEntry> = {},
): QueryEditorResultHistoryEntry => ({
  key,
  sql: `select '${key}'`,
  columns: ['id', 'payload'],
  rows: Array.from({ length: rowCount }, (_, index) => ({ id: index, payload: key })),
  ...overrides,
});

describe('query editor result history budget', () => {
  it('evicts the oldest unpinned results and preserves the active result', () => {
    const results = Array.from({ length: 25 }, (_, index) => buildResult(`result-${index + 1}`, 1));

    const budgeted = applyQueryEditorResultHistoryBudget(results, ['result-1']);

    expect(budgeted.resultSets).toHaveLength(QUERY_EDITOR_RESULT_HISTORY_MAX_RESULTS);
    expect(budgeted.resultSets.map((result) => result.key)).toContain('result-1');
    expect(budgeted.evictedKeys).toHaveLength(5);
  });

  it('bounds retained rows while keeping pinned results', () => {
    const results = Array.from({ length: 12 }, (_, index) => buildResult(
      `result-${index + 1}`,
      5_000,
      index < 2 ? { pinned: true } : {},
    ));

    const budgeted = applyQueryEditorResultHistoryBudget(results, ['result-12']);
    const retainedRows = budgeted.resultSets.reduce((sum, result) => sum + (result.rows?.length || 0), 0);

    expect(retainedRows).toBeLessThanOrEqual(QUERY_EDITOR_RESULT_HISTORY_MAX_ROWS);
    expect(budgeted.resultSets.slice(0, 2).every((result) => result.pinned)).toBe(true);
    expect(budgeted.resultSets.map((result) => result.key)).toContain('result-12');
  });

  it('rejects pinning beyond the explicit pinned-result budget', () => {
    const results = Array.from({ length: QUERY_EDITOR_PINNED_RESULT_MAX_RESULTS + 1 }, (_, index) => buildResult(
      `result-${index + 1}`,
      1,
      index < QUERY_EDITOR_PINNED_RESULT_MAX_RESULTS ? { pinned: true } : {},
    ));

    expect(canPinQueryEditorResult(results, results[results.length - 1].key)).toBe(false);
  });

  it('accounts for wide payloads in the estimated byte budget', () => {
    const sharedWidePayload = 'x'.repeat(2 * 1024 * 1024);
    const results = Array.from({ length: 20 }, (_, index) => buildResult(
      `wide-${index + 1}`,
      1,
      { rawResponse: sharedWidePayload },
    ));

    const budgeted = applyQueryEditorResultHistoryBudget(results, ['wide-20']);
    const retainedBytes = budgeted.resultSets.reduce(
      (sum, result) => sum + estimateQueryEditorResultSetBytes(result),
      0,
    );

    expect(retainedBytes).toBeLessThanOrEqual(QUERY_EDITOR_RESULT_HISTORY_MAX_BYTES);
    expect(budgeted.evictedKeys.length).toBeGreaterThan(0);
  });

  it('keeps results with pending edits while evicting older clean history', () => {
    const results = Array.from({ length: 22 }, (_, index) => buildResult(
      `result-${index + 1}`,
      1,
      index === 0 ? { hasPendingChanges: true } : {},
    ));

    const budgeted = applyQueryEditorResultHistoryBudget(results, ['result-22']);

    expect(budgeted.resultSets).toHaveLength(QUERY_EDITOR_RESULT_HISTORY_MAX_RESULTS);
    expect(budgeted.resultSets.map((result) => result.key)).toContain('result-1');
    expect(budgeted.resultSets.map((result) => result.key)).toContain('result-22');
  });

  it('scales object estimates for rows with many fields', () => {
    const narrow = buildResult('narrow', 0, {
      rows: [{ field: 'x'.repeat(1024) }],
    });
    const wide = buildResult('wide', 0, {
      rows: [{
        ...Object.fromEntries(Array.from({ length: 96 }, (_, index) => [
          `field_${index + 1}`,
          'x'.repeat(1024),
        ])),
      }],
    });

    expect(estimateQueryEditorResultSetBytes(wide)).toBeGreaterThan(
      estimateQueryEditorResultSetBytes(narrow) * 50,
    );
  });

  it('accounts for large restored selection state', () => {
    const result = buildResult('selected', 1, {
      selectedCellKeys: Array.from({ length: 50_000 }, (_, index) => `${index}\u0000payload`),
    });

    expect(estimateQueryEditorResultSetBytes(result)).toBeGreaterThan(1_000_000);
  });
});
