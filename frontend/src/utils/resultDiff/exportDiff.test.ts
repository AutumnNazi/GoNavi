import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import {
  buildDiffExportContent,
  collectExportColumns,
  exportDiffAsDelimited,
  exportDiffAsJson,
  exportDiffAsMarkdown,
  flattenDiffRow,
} from './exportDiff';
import type { ResultDiffRow, ResultDiffSummary } from './types';

const summary: ResultDiffSummary = {
  added: 1,
  removed: 1,
  changed: 1,
  same: 0,
  unmatched: 0,
  leftRowCount: 2,
  rightRowCount: 2,
  commonColumns: ['id', 'name', 'score'],
  leftOnlyColumns: [],
  rightOnlyColumns: [],
  changedColumnFreq: { score: 1 },
  keyColumns: ['id'],
  comparedColumns: ['id', 'name', 'score'],
};

const rows: ResultDiffRow[] = [
  {
    kind: 'changed',
    keys: { id: 1 },
    left: { id: 1, name: 'a', score: 10 },
    right: { id: 1, name: 'a', score: 11 },
    changedFields: [{ name: 'score', left: 10, right: 11 }],
  },
  {
    kind: 'added',
    keys: { id: 2 },
    right: { id: 2, name: 'b', score: 20 },
  },
  {
    kind: 'removed',
    keys: { id: 3 },
    left: { id: 3, name: 'c', score: 30 },
  },
];

describe('exportDiff', () => {
  it('flattens changed row with arrow values', () => {
    const flat = flattenDiffRow(rows[0], ['id', 'score']);
    expect(flat.kind).toBe('changed');
    expect(flat.score).toContain('→');
    expect(flat.score__left).toBe('10');
    expect(flat.score__right).toBe('11');
  });

  it('exports csv with bom and headers', () => {
    const csv = exportDiffAsDelimited(summary, rows, ',');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('kind');
    expect(csv).toContain('changed');
  });

  it('exports json with summary and rows', () => {
    const json = JSON.parse(
      exportDiffAsJson(summary, rows, { leftLabel: 'L', rightLabel: 'R' }),
    );
    expect(json.summary.added).toBe(1);
    expect(json.rows).toHaveLength(3);
  });

  it('exports markdown table', () => {
    const md = exportDiffAsMarkdown(summary, rows, { leftLabel: 'L', rightLabel: 'R' });
    expect(md).toContain('# Result Diff');
    expect(md).toContain('| Added | 1 |');
    expect(md).toContain('## Rows');
  });

  it('buildDiffExportContent returns extension per format', () => {
    const formats = ['csv', 'tsv', 'json', 'markdown', 'html', 'side_by_side'] as const;
    for (const format of formats) {
      const out = buildDiffExportContent(format, summary, rows, {
        leftLabel: 'L',
        rightLabel: 'R',
      });
      expect(out.extension).toBeTruthy();
      expect(out.content.length).toBeGreaterThan(10);
    }
  });

  it('side-by-side html has dual panes and cell marks', () => {
    const out = buildDiffExportContent('side_by_side', summary, rows, {
      leftLabel: 'Before',
      rightLabel: 'After',
    });
    expect(out.filenameBase).toContain('side-by-side');
    expect(out.content).toContain('pane-left');
    expect(out.content).toContain('pane-right');
    expect(out.content).toContain('cell-changed');
    expect(out.content).toContain('cell-added');
    expect(out.content).toContain('cell-removed');
    expect(out.content).toContain(t('result_diff.export.side_by_side_title'));
  });

  it('collectExportColumns prefers key columns', () => {
    const cols = collectExportColumns(summary, rows);
    expect(cols[0]).toBe('id');
    expect(cols).toContain('score');
  });

  it('collectExportColumns skips internal gonavi row keys', async () => {
    const { collectExportColumns: collect, isInternalResultDiffColumn } = await import('./exportDiff');
    expect(isInternalResultDiffColumn('__gonavi_row_key__')).toBe(true);
    expect(isInternalResultDiffColumn('id')).toBe(false);
    const cols = collect(summary, [
      {
        kind: 'added',
        keys: { id: 1 },
        right: { id: 1, name: 'x', __gonavi_row_key__: 'r1', GONAVI_ROW_KEY: 'r1' },
      },
    ]);
    expect(cols).not.toContain('__gonavi_row_key__');
    expect(cols).not.toContain('GONAVI_ROW_KEY');
    expect(cols).toContain('id');
  });
});
