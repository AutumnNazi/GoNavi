import { describe, expect, it } from 'vitest';

import {
  findConnectionChildren,
  foldRedisSidebarOverview,
  resolveRedisDbKeyCount,
} from './redisSidebarOverview';

const db = (index: number, keys: number) => ({
  type: 'redis-db',
  key: `redis-1-db${index}`,
  dataRef: { redisDB: index, redisKeyCount: keys },
});

describe('redisSidebarOverview / 概览聚合', () => {
  it('汇总各库 key 数与已用库数', () => {
    expect(foldRedisSidebarOverview([db(0, 32), db(1, 174), db(2, 18)])).toEqual({
      totalKeys: 224,
      usedDatabases: 3,
      totalDatabases: 3,
    });
  });

  it('空库计入总数但不计入已用', () => {
    // db6/db7 这类空库在侧栏行尾不显示计数，但它们是真实存在的库。
    const overview = foldRedisSidebarOverview([db(0, 32), db(6, 0), db(7, 0)]);

    expect(overview).toEqual({ totalKeys: 32, usedDatabases: 1, totalDatabases: 3 });
  });

  it('未展开（无子节点）时返回 null，而不是 0', () => {
    // 报 "0 个 Key" 会把「尚未测量」说成「确实是空库」——与 Nacos 徽标同一条约定。
    expect(foldRedisSidebarOverview(null)).toBeNull();
    expect(foldRedisSidebarOverview(undefined)).toBeNull();
    expect(foldRedisSidebarOverview([])).toBeNull();
  });

  it('忽略非 redis-db 子节点，且全非 redis-db 时返回 null', () => {
    expect(foldRedisSidebarOverview([{ type: 'table' }, { type: 'database' }])).toBeNull();
    expect(foldRedisSidebarOverview([{ type: 'table' }, db(0, 5)])).toEqual({
      totalKeys: 5,
      usedDatabases: 1,
      totalDatabases: 1,
    });
  });

  it('负值与非数字计数归零，不污染合计', () => {
    const dirty = [
      { type: 'redis-db', dataRef: { redisKeyCount: -9 } },
      { type: 'redis-db', dataRef: { redisKeyCount: 'abc' } },
      { type: 'redis-db', dataRef: {} },
      db(0, 7),
    ];

    expect(foldRedisSidebarOverview(dirty)).toEqual({
      totalKeys: 7,
      usedDatabases: 1,
      totalDatabases: 4,
    });
  });

  it('容忍脏子节点而不抛错', () => {
    expect(foldRedisSidebarOverview([null, undefined, db(0, 3)] as any)).toEqual({
      totalKeys: 3,
      usedDatabases: 1,
      totalDatabases: 1,
    });
    expect(foldRedisSidebarOverview({ type: 'redis-db' } as any)).toBeNull();
  });

  it('把「实测为空」与「未测量」分开：0 是已知值，缺失才是未知', () => {
    // 空库必须给出 0，而不是让调用方无从判断是空还是没取到数。
    expect(resolveRedisDbKeyCount(0)).toBe(0);
    expect(resolveRedisDbKeyCount('0')).toBe(0);
    expect(resolveRedisDbKeyCount(33)).toBe(33);
    expect(resolveRedisDbKeyCount('33')).toBe(33);

    // 未测量：必须返回 undefined，不得被 Number() 静默折成 0。
    expect(resolveRedisDbKeyCount(undefined)).toBeUndefined();
    expect(resolveRedisDbKeyCount(null)).toBeUndefined();
    expect(resolveRedisDbKeyCount('')).toBeUndefined();
    expect(resolveRedisDbKeyCount('   ')).toBeUndefined();
    expect(resolveRedisDbKeyCount('abc')).toBeUndefined();
    expect(resolveRedisDbKeyCount(-9)).toBeUndefined();
    expect(resolveRedisDbKeyCount(Number.NaN)).toBeUndefined();
    expect(resolveRedisDbKeyCount(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(resolveRedisDbKeyCount({})).toBeUndefined();
  });

  it('小数计数向下取整，与后端整数语义一致', () => {
    expect(resolveRedisDbKeyCount(12.7)).toBe(12);
    expect(resolveRedisDbKeyCount('12.7')).toBe(12);
  });

  it('合计把未知计数当作未贡献，不污染总和', () => {
    const mixed = [
      db(0, 0),
      { type: 'redis-db', dataRef: { redisKeyCount: null } },
      { type: 'redis-db', dataRef: {} },
      db(3, 5),
    ];

    expect(foldRedisSidebarOverview(mixed)).toEqual({
      totalKeys: 5,
      usedDatabases: 1,
      totalDatabases: 4,
    });
  });
});

describe('redisSidebarOverview / 连接子节点查找', () => {
  const tree = [
    {
      type: 'tag',
      key: 'group-dev',
      children: [
        { type: 'connection', key: 'redis-1', children: [db(0, 1)] },
        { type: 'connection', key: 'mysql-1', children: [{ type: 'database' }] },
      ],
    },
    { type: 'connection', key: 'redis-2', children: [db(0, 2)] },
    { type: 'connection', key: 'redis-3' },
  ];

  it('在连接分组内找到连接的子节点', () => {
    expect(findConnectionChildren(tree, 'redis-1')).toHaveLength(1);
  });

  it('在顶层找到连接的子节点', () => {
    expect(findConnectionChildren(tree, 'redis-2')).toHaveLength(1);
  });

  it('未展开的连接返回 null（不得当作空数组）', () => {
    expect(findConnectionChildren(tree, 'redis-3')).toBeNull();
  });

  it('未知连接与空输入返回 null', () => {
    expect(findConnectionChildren(tree, 'nope')).toBeNull();
    expect(findConnectionChildren(tree, '')).toBeNull();
    expect(findConnectionChildren(null, 'redis-1')).toBeNull();
    expect(findConnectionChildren(undefined, 'redis-1')).toBeNull();
  });

  it('键相同但类型不是 connection 时不误匹配', () => {
    const decoy = [{ type: 'database', key: 'redis-1', children: [db(0, 9)] }];

    expect(findConnectionChildren(decoy, 'redis-1')).toBeNull();
  });
});
