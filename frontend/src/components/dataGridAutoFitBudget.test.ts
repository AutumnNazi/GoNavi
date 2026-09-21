/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { calculateAutoFitColumnWidth, createDataGridCanvasTextMeasurer, resolveAutoFitSampleLimit } from './dataGridAutoWidth';

// Print-only benchmark plus the invariant that makes it meaningful: the number
// of measureText calls in one synchronous auto-fit pass must stay bounded, so
// opening a wide result set cannot scale with (columns x rows).
const buildRows = (rowCount: number, columnCount: number, sampleLimit: number) => {
  const rows = Array.from({ length: rowCount }, (_, r) => {
    const row: Record<string, unknown> = {};
    for (let c = 0; c < columnCount; c += 1) {
      row[`column_${c}`] = c % 3 === 0 ? `value_${r}_${c}` : `${r * 1000 + c}`;
    }
    return row;
  });
  return rows.slice(0, sampleLimit);
};

const measureCalls = (columnCount: number) => {
  const sampleLimit = resolveAutoFitSampleLimit(columnCount);
  const columnNames = Array.from({ length: columnCount }, (_, c) => `column_${c}`);
  const sample = buildRows(200, columnCount, sampleLimit);
  const font = '13px "JetBrains Mono", ui-monospace, monospace';
  let calls = 0;
  const measure = (text: string, f: string) => {
    calls += 1;
    return text.length * 7;
  };

  const started = performance.now();
  for (const columnName of columnNames) {
    calculateAutoFitColumnWidth({
      headerTexts: [columnName],
      valueTexts: sample.map((row) => row?.[columnName]),
      measureHeaderText: (text) => measure(text, `600 ${font}`),
      measureCellText: (text) => measure(text, `400 ${font}`),
      minWidth: 80,
      maxWidth: 600,
      defaultWidth: 100,
    });
  }
  return { calls, elapsed: performance.now() - started, sampleLimit };
};

describe('auto-fit measurement budget', () => {
  it('bounds the synchronous measurement count regardless of column count', () => {
    const results = [10, 20, 50, 100, 200].map((columnCount) => ({
      columnCount,
      ...measureCalls(columnCount),
    }));

    for (const entry of results) {
      // eslint-disable-next-line no-console
      console.log(
        `[autofit] ${String(entry.columnCount).padStart(3)} 列  采样 ${String(entry.sampleLimit).padStart(3)} 行`
        + `  measureText ${String(entry.calls).padStart(5)} 次  ${entry.elapsed.toFixed(1)} ms`,
      );
    }

    // The whole point of the budget: a 200-column result must not cost ~10x the
    // calls of a 20-column one.
    const twenty = results.find((entry) => entry.columnCount === 20)!;
    const twoHundred = results.find((entry) => entry.columnCount === 200)!;
    expect(twoHundred.calls).toBeLessThan(twenty.calls * 2);
    for (const entry of results) {
      expect(entry.calls).toBeLessThanOrEqual(3000);
    }
  });

  it('keeps a full-width sample for narrow result sets', () => {
    expect(resolveAutoFitSampleLimit(0)).toBe(0);
    expect(resolveAutoFitSampleLimit(1)).toBe(200);
    expect(resolveAutoFitSampleLimit(6)).toBe(200);
    expect(resolveAutoFitSampleLimit(60)).toBe(20);
    expect(resolveAutoFitSampleLimit(1000)).toBe(8);
  });
});
