import { describe, expect, it, vi } from 'vitest';

import { resolveSidebarTreeMetaText, type SidebarTreeMetaSources } from './sidebarTreeMetaText';

const sources = (overrides: Partial<SidebarTreeMetaSources> = {}): SidebarTreeMetaSources => ({
  countTagConnections: () => 0,
  countObjectGroupObjects: () => 0,
  formatRowCount: (rowCount) => String(rowCount),
  ...overrides,
});

describe('sidebarTreeMetaText / 行尾计数', () => {
  it('空库显示 0，未测量的库留空 —— 两者必须可区分', () => {
    // 这是本次修复的核心：实测为空是一个值得显示的事实，
    // 只有「没取到数」才留空。
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', dataRef: { redisKeyCount: 0 } },
      sources(),
    )).toBe('0');

    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', dataRef: { redisKeyCount: 33 } },
      sources(),
    )).toBe('33');

    // 未测量：loader 未写入 redisKeyCount。
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', dataRef: {} },
      sources(),
    )).toBe('');
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db' },
      sources(),
    )).toBe('');
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', dataRef: { redisKeyCount: null } },
      sources(),
    )).toBe('');
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', dataRef: { redisKeyCount: 'abc' } },
      sources(),
    )).toBe('');
  });

  it('不再从标题里抠 (数字)：别名以 (123) 结尾时不得被当成 key 数', () => {
    // 回归守卫。旧实现有一条 `/(\((\d+)\))\s*$/` 兜底，会把别名
    // 「db0 production (123)」读成 123 个 key —— 别名是用户自由输入的，
    // sanitizeRedisDbAlias 并不剥离这种后缀，所以那是条真实的假阳性通道。
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', title: 'db0 production (123)', dataRef: {} },
      sources(),
    )).toBe('');
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', title: 'db0 (123)', dataRef: {} },
      sources(),
    )).toBe('');
    // 标题里有数字、dataRef 里是真实计数时，只认 dataRef。
    expect(resolveSidebarTreeMetaText(
      { type: 'redis-db', title: 'db0 production (123)', dataRef: { redisKeyCount: 7 } },
      sources(),
    )).toBe('7');
  });

  it('tag 行统计连线数量，0 时留空', () => {
    expect(resolveSidebarTreeMetaText(
      { type: 'tag' },
      sources({ countTagConnections: () => 12 }),
    )).toBe('12');
    expect(resolveSidebarTreeMetaText(
      { type: 'tag' },
      sources({ countTagConnections: () => 0 }),
    )).toBe('');
  });

  it('object-group 行读分组计数，0 时留空', () => {
    expect(resolveSidebarTreeMetaText(
      { type: 'object-group' },
      sources({ countObjectGroupObjects: () => 42 }),
    )).toBe('42');
    expect(resolveSidebarTreeMetaText(
      { type: 'object-group' },
      sources({ countObjectGroupObjects: () => 0 }),
    )).toBe('');
  });

  it('table 行用调用方给的格式化器，负数与非法值留空', () => {
    const format = vi.fn((rowCount: number) => `~${rowCount}`);
    expect(resolveSidebarTreeMetaText(
      { type: 'table', dataRef: { rowCount: 1500 } },
      sources({ formatRowCount: format }),
    )).toBe('~1500');
    expect(format).toHaveBeenCalledWith(1500);

    expect(resolveSidebarTreeMetaText({ type: 'table', dataRef: { rowCount: -1 } }, sources())).toBe('');
    expect(resolveSidebarTreeMetaText({ type: 'table', dataRef: { rowCount: 'x' } }, sources())).toBe('');
    expect(resolveSidebarTreeMetaText({ type: 'table', dataRef: {} }, sources())).toBe('');
  });

  it('未知节点类型、null、undefined 一律留空', () => {
    expect(resolveSidebarTreeMetaText({ type: 'database' }, sources())).toBe('');
    expect(resolveSidebarTreeMetaText({ type: 'connection' }, sources())).toBe('');
    expect(resolveSidebarTreeMetaText(null, sources())).toBe('');
    expect(resolveSidebarTreeMetaText(undefined, sources())).toBe('');
  });

  it('只调用与自身类型相关的那一个计数源 —— titleRender 是热路径', () => {
    // 若在抽离时把这几个计数源改成提前求值，每一行都会付出整棵子树遍历的
    // 代价。这里把「惰性」本身锁住。
    const countTagConnections = vi.fn(() => 3);
    const countObjectGroupObjects = vi.fn(() => 4);
    const formatRowCount = vi.fn((rowCount: number) => String(rowCount));
    const all = sources({ countTagConnections, countObjectGroupObjects, formatRowCount });

    resolveSidebarTreeMetaText({ type: 'redis-db', dataRef: { redisKeyCount: 1 } }, all);
    resolveSidebarTreeMetaText({ type: 'table', dataRef: { rowCount: 2 } }, all);
    expect(countTagConnections).not.toHaveBeenCalled();
    expect(countObjectGroupObjects).not.toHaveBeenCalled();

    resolveSidebarTreeMetaText({ type: 'tag' }, all);
    expect(countTagConnections).toHaveBeenCalledTimes(1);
    expect(countObjectGroupObjects).not.toHaveBeenCalled();
  });
});
