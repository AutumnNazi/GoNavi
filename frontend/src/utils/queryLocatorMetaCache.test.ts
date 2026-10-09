// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';

import {
    LOCATOR_META_MAX_ENTRIES,
    LOCATOR_META_TTL_MS,
    clearLocatorMetaCache,
    clearLocatorMetaCacheByConnection,
    getLocatorMetaCacheKey,
    getLocatorMetaCached,
    setLocatorMetaCached,
    uninstallLocatorMetaCacheInvalidationListener,
    __getLocatorMetaCacheSize,
} from './queryLocatorMetaCache';
import {
    SIDEBAR_DATABASE_REFRESH_EVENT,
    dispatchSidebarDatabaseRefresh,
} from './sidebarDatabaseRefresh';

afterEach(() => {
    clearLocatorMetaCache();
    uninstallLocatorMetaCacheInvalidationListener();
});

const baseConfig = {
    id: 'conn-1',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    database: 'mydb',
    type: 'mysql',
    password: 'secret',
};

describe('getLocatorMetaCacheKey', () => {
    it('同连接 + 同库 + 同表 → 相同 key', () => {
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'))
            .toBe(getLocatorMetaCacheKey({ ...baseConfig }, 'mydb', 'sys_user'));
    });

    it('不同表 / 不同库 → 不同 key', () => {
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'))
            .not.toBe(getLocatorMetaCacheKey(baseConfig, 'mydb', 't_order'));
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'))
            .not.toBe(getLocatorMetaCacheKey(baseConfig, 'otherdb', 'sys_user'));
    });

    it('不同连接 → 不同 key', () => {
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'))
            .not.toBe(getLocatorMetaCacheKey({ ...baseConfig, id: 'conn-2' }, 'mydb', 'sys_user'));
    });

    it('密码变化不影响 key（不含敏感信息）', () => {
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'))
            .toBe(getLocatorMetaCacheKey({ ...baseConfig, password: 'other' }, 'mydb', 'sys_user'));
        expect(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user')).not.toContain('secret');
    });
});

describe('getLocatorMetaCached / setLocatorMetaCached', () => {
    it('写入后命中，且快照内容原样取回', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { columns: [{ name: 'id' } as any], indexes: [{ name: 'pk' } as any] }, 1000);
        const snapshot = getLocatorMetaCached(key, 1000);
        expect(snapshot?.columns).toHaveLength(1);
        expect(snapshot?.indexes).toHaveLength(1);
    });

    it('未写入 → null', () => {
        expect(getLocatorMetaCached(getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user'), 1000)).toBeNull();
    });

    it('TTL 内命中、过期后 null', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { indexes: [] }, 1000);
        expect(getLocatorMetaCached(key, 1000 + LOCATOR_META_TTL_MS - 1)).not.toBeNull();
        expect(getLocatorMetaCached(key, 1000 + LOCATOR_META_TTL_MS + 1)).toBeNull();
    });

    it('命中缓存时不再依赖真实时钟（注入 now 生效）', () => {
        const key = 'any-key';
        setLocatorMetaCached(key, { columns: [] }, 5_000);
        const spy = vi.spyOn(Date, 'now');
        expect(getLocatorMetaCached(key, 5_000)).not.toBeNull();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('容量上限淘汰', () => {
    it('超过上限时按插入序淘汰最旧，size 不超过上限', () => {
        for (let i = 0; i < LOCATOR_META_MAX_ENTRIES + 20; i += 1) {
            setLocatorMetaCached(`k-${i}`, { indexes: [] }, i);
        }
        expect(__getLocatorMetaCacheSize()).toBe(LOCATOR_META_MAX_ENTRIES);
        expect(getLocatorMetaCached('k-0', LOCATOR_META_MAX_ENTRIES + 20)).toBeNull();
        expect(getLocatorMetaCached(`k-${LOCATOR_META_MAX_ENTRIES + 19}`, LOCATOR_META_MAX_ENTRIES + 20)).not.toBeNull();
    });
});

describe('clearLocatorMetaCache', () => {
    it('清空后不再命中', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { indexes: [] }, 1000);
        clearLocatorMetaCache();
        expect(getLocatorMetaCached(key, 2000)).toBeNull();
    });
});

describe('clearLocatorMetaCacheByConnection', () => {
    it('只清该连接的条目，其它连接保留', () => {
        const mine = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        const otherConn = getLocatorMetaCacheKey({ ...baseConfig, id: 'conn-2' }, 'mydb', 'sys_user');
        const otherTable = getLocatorMetaCacheKey(baseConfig, 'mydb', 't_order');
        setLocatorMetaCached(mine, { indexes: [] }, 1000);
        setLocatorMetaCached(otherConn, { indexes: [] }, 1000);
        setLocatorMetaCached(otherTable, { indexes: [] }, 1000);

        clearLocatorMetaCacheByConnection('conn-1');

        expect(getLocatorMetaCached(mine, 1000)).toBeNull();
        expect(getLocatorMetaCached(otherTable, 1000)).toBeNull();
        expect(getLocatorMetaCached(otherConn, 1000)).not.toBeNull();
    });

    it('指定库名时只清该库', () => {
        const inDb = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        const otherDb = getLocatorMetaCacheKey(baseConfig, 'otherdb', 'sys_user');
        setLocatorMetaCached(inDb, { indexes: [] }, 1000);
        setLocatorMetaCached(otherDb, { indexes: [] }, 1000);

        clearLocatorMetaCacheByConnection('conn-1', 'mydb');

        expect(getLocatorMetaCached(inDb, 1000)).toBeNull();
        expect(getLocatorMetaCached(otherDb, 1000)).not.toBeNull();
    });

    it('不会误伤连接 id 前缀相同的其它连接', () => {
        const conn1 = getLocatorMetaCacheKey(baseConfig, 'mydb', 't1');
        const conn10 = getLocatorMetaCacheKey({ ...baseConfig, id: 'conn-10' }, 'mydb', 't1');
        setLocatorMetaCached(conn1, { indexes: [] }, 1000);
        setLocatorMetaCached(conn10, { indexes: [] }, 1000);

        clearLocatorMetaCacheByConnection('conn-1');

        expect(getLocatorMetaCached(conn1, 1000)).toBeNull();
        expect(getLocatorMetaCached(conn10, 1000)).not.toBeNull();
    });

    it('空连接 id 不做任何事', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { indexes: [] }, 1000);
        clearLocatorMetaCacheByConnection('');
        expect(getLocatorMetaCached(key, 1000)).not.toBeNull();
    });
});

describe('DDL 失效钩子', () => {
    it('schema 变更刷新事件到达时清掉该连接的缓存', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { indexes: [] }, 1000);

        dispatchSidebarDatabaseRefresh({ connectionId: 'conn-1', dbName: 'mydb' });

        expect(getLocatorMetaCached(key, 1000)).toBeNull();
    });

    it('事件不带 dbName 时清掉该连接全部表', () => {
        const t1 = getLocatorMetaCacheKey(baseConfig, 'mydb', 't1');
        const t2 = getLocatorMetaCacheKey(baseConfig, 'otherdb', 't2');
        setLocatorMetaCached(t1, { indexes: [] }, 1000);
        setLocatorMetaCached(t2, { indexes: [] }, 1000);

        window.dispatchEvent(new CustomEvent(SIDEBAR_DATABASE_REFRESH_EVENT, {
            detail: { connectionId: 'conn-1' },
        }));

        expect(getLocatorMetaCached(t1, 1000)).toBeNull();
        expect(getLocatorMetaCached(t2, 1000)).toBeNull();
    });

    it('无关连接的事件不影响本连接缓存', () => {
        const key = getLocatorMetaCacheKey(baseConfig, 'mydb', 'sys_user');
        setLocatorMetaCached(key, { indexes: [] }, 1000);

        dispatchSidebarDatabaseRefresh({ connectionId: 'conn-other', dbName: 'mydb' });

        expect(getLocatorMetaCached(key, 1000)).not.toBeNull();
    });
});
