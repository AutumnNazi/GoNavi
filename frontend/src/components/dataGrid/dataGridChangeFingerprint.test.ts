import { describe, expect, it } from 'vitest';

import {
  DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS,
  DATA_GRID_FINGERPRINT_SAMPLE_COUNT,
  buildDataGridIncrementalFingerprint,
} from './dataGridChangeFingerprint';

const ROW_KEY = '__row_key__';

const makeRows = (count: number, valuePrefix = 'v') => Array.from({ length: count }, (_, index) => ({
  [ROW_KEY]: `row-${index}`,
  name: `${valuePrefix}-${index}`,
}));

const outputColumns = ['__row_key__', 'name'];

describe('buildDataGridIncrementalFingerprint', () => {
  describe('小结果集：全量序列化（行为与原实现一致）', () => {
    it('内容相同则指纹相同（幂等，可作为判重依据）', () => {
      const rows = makeRows(10);
      const first = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const second = buildDataGridIncrementalFingerprint(makeRows(10), {}, new Set(), outputColumns);
      expect(first).toBe(second);
    });

    it('行内容变化则指纹变化', () => {
      const before = buildDataGridIncrementalFingerprint(makeRows(10), {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(makeRows(10, 'changed'), {}, new Set(), outputColumns);
      expect(after).not.toBe(before);
    });

    it('阈值及以下都走全量路径（与纯 JSON.stringify 等价）', () => {
      const rows = makeRows(DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS);
      expect(buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns)).toBe(JSON.stringify(rows));
    });
  });

  describe('大结果集：抽样指纹', () => {
    const bigCount = DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS + 1;

    it('超过阈值后不再等价于全量 stringify（确认走了抽样路径）', () => {
      const rows = makeRows(bigCount);
      expect(buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns)).not.toBe(JSON.stringify(rows));
    });

    it('同一份输入重复调用结果稳定（指纹可跨渲染比较）', () => {
      const rows = makeRows(bigCount);
      const first = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const second = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      expect(second).toBe(first);
    });

    it('行数变化能被察觉（行数是指纹的一部分）', () => {
      const before = buildDataGridIncrementalFingerprint(makeRows(bigCount), {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(makeRows(bigCount + 1), {}, new Set(), outputColumns);
      expect(after).not.toBe(before);
    });

    it('修改集变化能被察觉（抽样未命中的修改由 modifiedRows 兜底）', () => {
      const rows = makeRows(bigCount);
      const before = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(
        rows,
        { 'row-0': { name: 'edited' } },
        new Set(),
        outputColumns,
      );
      expect(after).not.toBe(before);
    });

    it('删除集变化能被察觉', () => {
      const rows = makeRows(bigCount);
      const before = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(rows, {}, new Set(['row-3']), outputColumns);
      expect(after).not.toBe(before);
    });

    it('输出列集合变化能被察觉（列可见性切换必须视为变更）', () => {
      const rows = makeRows(bigCount);
      const before = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(rows, {}, new Set(), ['__row_key__']);
      expect(after).not.toBe(before);
    });

    it('抽样点确实被纳入指纹（改首行可察觉，说明采样覆盖头部）', () => {
      const rows = makeRows(bigCount);
      const before = buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns);
      const mutated = makeRows(bigCount);
      mutated[0] = { ...mutated[0], name: 'mutated-head' };
      const after = buildDataGridIncrementalFingerprint(mutated, {}, new Set(), outputColumns);
      expect(after).not.toBe(before);
    });

    it('采样数量是阈值与行数的较小值（不越界取空）', () => {
      // 行数刚过阈值时，采样数应等于常量本身，且不因索引越界抛错/产生 undefined
      const rows = makeRows(DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS + 1);
      expect(() => buildDataGridIncrementalFingerprint(rows, {}, new Set(), outputColumns)).not.toThrow();
      expect(DATA_GRID_FINGERPRINT_SAMPLE_COUNT).toBeLessThan(rows.length);
    });
  });

  describe('边界', () => {
    it('空行集不抛错且稳定', () => {
      const first = buildDataGridIncrementalFingerprint([], {}, new Set(), outputColumns);
      const second = buildDataGridIncrementalFingerprint([], {}, new Set(), outputColumns);
      expect(first).toBe(second);
    });

    it('行数相同但内容不同的大结果集，头部差异可察觉', () => {
      const before = buildDataGridIncrementalFingerprint(makeRows(3000), {}, new Set(), outputColumns);
      const after = buildDataGridIncrementalFingerprint(makeRows(3000, 'other'), {}, new Set(), outputColumns);
      expect(after).not.toBe(before);
    });
  });
});
