import { describe, expect, it } from 'vitest';

import { capResultSets, MAX_RESULT_SETS_PER_EDITOR } from './boundedResultSets';

type TestResultSet = {
  key?: string;
  pinned?: boolean;
  hasPendingChanges?: boolean;
};

const buildSets = (
  count: number,
  overrides: Partial<TestResultSet> = {},
): TestResultSet[] => Array.from({ length: count }, (_, index) => ({
  key: `result-${index + 1}`,
  ...overrides,
}));

describe('capResultSets', () => {
  it('超过上限时从队首淘汰最旧的结果集', () => {
    const sets = buildSets(25);

    const { items, evicted } = capResultSets(sets);

    expect(items).toHaveLength(MAX_RESULT_SETS_PER_EDITOR);
    expect(evicted.map((item) => item.key)).toEqual([
      'result-1', 'result-2', 'result-3', 'result-4', 'result-5',
    ]);
    // 保留顺序即加入顺序，最新的一定在尾部
    expect(items.map((item) => item.key)).toEqual(
      Array.from({ length: 20 }, (_, index) => `result-${index + 6}`),
    );
  });

  it('未超过上限时原样返回且不做任何淘汰', () => {
    const sets = buildSets(MAX_RESULT_SETS_PER_EDITOR);

    const { items, evicted } = capResultSets(sets);

    expect(items).toBe(sets);
    expect(evicted).toEqual([]);
  });

  // 移植陷阱：yxdb 的 capResultSets 只按条数淘汰队首。GoNavi 的 resultSet 有 pinned
  // 语义，照搬会把用户固定的结果集淘汰掉——这里是最关键的行为回归断言。
  it('绝不淘汰 pinned 结果集，超限时只淘汰最旧的非豁免项', () => {
    const sets: TestResultSet[] = [
      { key: 'result-1', pinned: true },
      { key: 'result-2' },
      { key: 'result-3' },
      ...buildSets(21).map((item, index) => ({ ...item, key: `result-${index + 4}` })),
    ];

    const { items, evicted } = capResultSets(sets, { max: 20 });

    expect(items.some((item) => item.key === 'result-1' && item.pinned)).toBe(true);
    expect(evicted.some((item) => item.pinned)).toBe(false);
    // 共 24 条，需腾出 4 条；result-1 豁免被跳过，接着淘汰 4 条最旧的普通项
    expect(evicted.map((item) => item.key)).toEqual(['result-2', 'result-3', 'result-4', 'result-5']);
  });

  it('全部 pinned 时不淘汰任何结果集（豁免优先于上限）', () => {
    const sets = buildSets(30, { pinned: true });

    const { items, evicted } = capResultSets(sets, { max: 20 });

    expect(items).toHaveLength(30);
    expect(evicted).toEqual([]);
  });

  it('pendingChanges 与 protectedKeys 命中项同样不被淘汰', () => {
    const sets: TestResultSet[] = [
      { key: 'pending', hasPendingChanges: true },
      { key: 'active' },
      ...buildSets(21),
    ];

    const { items, evicted } = capResultSets(sets, { max: 20, protectedKeys: ['active'] });

    const keptKeys = items.map((item) => item.key);
    expect(keptKeys).toContain('pending');
    expect(keptKeys).toContain('active');
    expect(evicted.some((item) => item.key === 'pending' || item.key === 'active')).toBe(false);
    // 23 条需腾出 3 条，豁免两项被跳过，淘汰 3 条最旧普通项
    expect(evicted.map((item) => item.key)).toEqual(['result-1', 'result-2', 'result-3']);
    expect(items).toHaveLength(20);
  });

  it('豁免项夹在中间时被跳过，淘汰继续向队首后方推进', () => {
    // keep-pinned 夹在最旧的 2 个普通项之后：淘汰应从最旧的普通项开始，遇到 pinned 跳过
    const sets: TestResultSet[] = [
      { key: 'old-1' },
      { key: 'old-2' },
      { key: 'keep-pinned', pinned: true },
      ...buildSets(20),
    ];

    const { items, evicted } = capResultSets(sets, { max: 20 });

    // 23 条需腾出 3 条：old-1、old-2，以及跳过 keep-pinned 后的 result-1
    expect(evicted.map((item) => item.key)).toEqual(['old-1', 'old-2', 'result-1']);
    expect(items.some((item) => item.key === 'keep-pinned')).toBe(true);
    expect(items).toHaveLength(20);
  });

  it('兼容空数组与非法输入', () => {
    expect(capResultSets([])).toEqual({ items: [], evicted: [] });
    expect(capResultSets(null as any)).toEqual({ items: [], evicted: [] });
  });
});
