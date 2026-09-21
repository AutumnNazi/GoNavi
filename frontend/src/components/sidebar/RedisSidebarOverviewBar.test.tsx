import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RedisSidebarOverviewBar from './RedisSidebarOverviewBar';

const redisConn = { id: 'redis-1', config: { type: 'redis', host: 'localhost', port: 6379 } };

const db = (index: number, keys: number) => ({
  type: 'redis-db',
  key: `redis-1-db${index}`,
  dataRef: { redisDB: index, redisKeyCount: keys },
});

const tree = (children: any[] | undefined) => ([
  { type: 'connection', key: 'redis-1', children },
]);

const render = (connection: any, treeData: any) => renderToStaticMarkup(
  <RedisSidebarOverviewBar connection={connection} treeData={treeData} />,
);

describe('RedisSidebarOverviewBar', () => {
  it('渲染总 Key 数与已用库数', () => {
    const markup = render(redisConn, tree([db(0, 1234), db(1, 77)]));

    expect(markup).toContain('data-redis-sidebar-overview="true"');
    expect(markup).toContain('data-redis-total-keys="1311"');
    expect(markup).toContain('data-redis-used-dbs="2"');
    expect(markup).toContain('data-redis-total-dbs="2"');
    // 千分位由 toLocaleString 产出；只断言数字本身，避免绑定运行环境 locale。
    expect(markup).toContain('1,311');
  });

  it('空库计入库数但不计入已用', () => {
    const markup = render(redisConn, tree([db(0, 32), db(6, 0)]));

    expect(markup).toContain('data-redis-total-keys="32"');
    expect(markup).toContain('data-redis-used-dbs="1"');
    expect(markup).toContain('data-redis-total-dbs="2"');
  });

  it('连接未展开时不渲染任何内容，而不是 0', () => {
    // 报 "0 keys" 会把「尚未测量」说成「确实是空库」。
    expect(render(redisConn, tree(undefined))).toBe('');
    expect(render(redisConn, [])).toBe('');
  });

  it('非 Redis 连接时不渲染', () => {
    const mysql = { id: 'mysql-1', config: { type: 'mysql', host: 'localhost' } };
    const mysqlTree = [{ type: 'connection', key: 'mysql-1', children: [db(0, 5)] }];

    expect(render(mysql, mysqlTree)).toBe('');
    expect(render(null, tree([db(0, 5)]))).toBe('');
  });

  it('通过 aria 暴露可读概览', () => {
    const markup = render(redisConn, tree([db(0, 5)]));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label=');
  });
});
