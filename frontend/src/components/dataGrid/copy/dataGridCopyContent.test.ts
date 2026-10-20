import { describe, expect, it, vi } from 'vitest';
import {
  buildDataGridCopyContent, canCopyDataGridContent, resolveDataGridCopyMatrix,
  type DataGridCopyContent, type DataGridCopyScope, type DataGridCopySelection,
} from './dataGridCopyContent';

const input: DataGridCopySelection = {
  rows: [{ key: 'b', name: 'Bob', id: 2 }, { key: 'a', name: 'Alice', id: 1 }],
  columnNames: ['name', 'key', 'id'], selectedRowKeys: ['a'], selectedCells: [], rowKeyField: 'key',
};
const scopes: DataGridCopyScope[] = ['selected', 'allLoaded'];
const modes: DataGridCopyContent[] = ['headers', 'data', 'headersAndData'];

describe('regular copy content matrix', () => {
  for (const scope of scopes) for (const mode of modes) {
    it(`${scope} / ${mode} keeps exact range and header semantics`, () => {
      const matrix = resolveDataGridCopyMatrix(input, scope, mode);
      const payload = buildDataGridCopyContent(matrix, mode);
      const data = scope === 'selected' ? 'Alice\t1' : 'Bob\t2\nAlice\t1';
      expect(payload?.plainText).toBe(mode === 'headers' ? 'name\tid' : mode === 'data' ? data : `name\tid\n${data}`);
      expect(payload?.html?.includes('<thead>')).toBe(mode !== 'data');
      expect(payload?.html).not.toContain('<th>key</th>');
      if (mode === 'data') expect(payload?.html).toContain('<td>');
    });
  }

  it('keeps displayed order instead of row checkbox selection order', () => {
    expect(resolveDataGridCopyMatrix({ ...input, selectedRowKeys: ['a', 'b'] }, 'selected').rows)
      .toEqual([['Bob', '2'], ['Alice', '1']]);
  });

  it('prioritizes cell selection, excludes hidden/internal columns and fills sparse holes', () => {
    const matrix = resolveDataGridCopyMatrix({ ...input, selectedCells: [
      { rowKey: 'a', colName: 'id' }, { rowKey: 'b', colName: 'name' },
      { rowKey: 'b', colName: 'key' }, { rowKey: 'a', colName: 'hidden' },
    ] }, 'selected');
    expect(matrix).toEqual({ columns: ['name', 'id'], rows: [['Bob', ''], ['', '1']] });
  });

  it('selected headers include only valid box columns; all ignores every selection', () => {
    const boxed = { ...input, selectedCells: [{ rowKey: 'b', colName: 'id' }] };
    expect(buildDataGridCopyContent(resolveDataGridCopyMatrix(boxed, 'selected', 'headers'), 'headers')?.plainText).toBe('id');
    expect(resolveDataGridCopyMatrix(boxed, 'allLoaded')).toEqual(resolveDataGridCopyMatrix(input, 'allLoaded'));
  });

  it('does not fall back to all rows or checked rows for absent/stale/invalid selection', () => {
    for (const selected of [
      { ...input, selectedRowKeys: [] },
      { ...input, selectedRowKeys: ['gone'] },
      { ...input, selectedCells: [{ rowKey: 'gone', colName: 'id' }] },
      { ...input, hasCellSelection: true },
    ]) for (const mode of modes) {
      expect(buildDataGridCopyContent(resolveDataGridCopyMatrix(selected, 'selected', mode), mode)).toBeNull();
    }
  });

  it('allows empty results only for all-loaded headers and rejects missing output columns', () => {
    const matrix = resolveDataGridCopyMatrix({ ...input, rows: [] }, 'allLoaded');
    expect(canCopyDataGridContent(matrix, 'headers')).toBe(true);
    expect(canCopyDataGridContent(matrix, 'data')).toBe(false);
    expect(canCopyDataGridContent(matrix, 'headersAndData')).toBe(false);
    expect(canCopyDataGridContent(resolveDataGridCopyMatrix({ ...input, columnNames: ['key'] }, 'allLoaded'), 'headers')).toBe(false);
  });

  it('preserves NULL, literal NULL, empty values, tabs, newlines, quotes and HTML escapes', () => {
    const matrix = { columns: ['a'], rows: [[null], ['NULL'], [''], ['x\ty\n"z" <tag>&']] };
    const payload = buildDataGridCopyContent(matrix, 'data');
    expect(payload?.plainText).toBe('NULL\n"NULL"\n""\n"x\ty\n""z"" <tag>&"');
    expect(payload?.html).toContain('data-gonavi-null="true"');
    expect(payload?.html).toContain('x\ty\n&quot;z&quot; &lt;tag&gt;&amp;');
    expect(payload?.html).not.toContain('<thead>');
    expect(JSON.parse(payload?.json ?? '{}').values).toEqual(matrix.rows);
  });

  it('copies a single empty string rather than treating it as no selection', () => {
    expect(buildDataGridCopyContent({ columns: ['name'], rows: [['']] }, 'data')?.plainText).toBe('""');
  });

  it('does not format data for headers-only copies', () => {
    const formatCell = vi.fn(() => 'formatted');
    for (const scope of scopes) resolveDataGridCopyMatrix({ ...input, formatCell }, scope, 'headers');
    expect(formatCell).not.toHaveBeenCalled();
  });
});
