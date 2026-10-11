/**
 * 行定位计划元数据 TTL 缓存（性能专项）
 *
 * resolveQueryLocatorPlan 每次执行前都会并行调 DBGetColumns + DBGetIndexes 两次 IPC，
 * 拿主键/唯一索引来构建行定位（决定结果页能否编辑/回写）。同一张表在连续执行间隙里
 * 元数据基本不变，但这两次往返 + 前端解析每次都要重付一遍，低配机上是「点击 → 执行」
 * 之间的固定开销。
 *
 * 这里只做「同一张表的列/索引快照短期内复用」这一件事，纯内存、零依赖、可注入时间单测。
 * 注意：本缓存是**叠加**在调用方既有的 1500ms 软超时兜底之上的，不是替换它——
 * 命中时近零耗时，未命中时该超时仍照常生效。
 */

import type { ColumnDefinition, IndexDefinition } from '../types';
import {
    SIDEBAR_DATABASE_REFRESH_EVENT,
    normalizeSidebarDatabaseRefreshRequest,
} from './sidebarDatabaseRefresh';

/** 缓存有效期（毫秒）：120s。结构变更由失效钩子（DDL 执行成功）收敛，
 *  因此不必依赖短 TTL 兜底；TTL 过短会让两次执行间隔一超就重新拉取，白付两次 IPC。 */
export const LOCATOR_META_TTL_MS = 120_000;
/** 条目上限：防多连接 × 多表无限增长（超出时按插入序淘汰最旧）。 */
export const LOCATOR_META_MAX_ENTRIES = 500;

export interface LocatorMetaSnapshot {
    columns?: ColumnDefinition[];
    indexes?: IndexDefinition[];
}

interface LocatorMetaEntry {
    ts: number;
    snapshot: LocatorMetaSnapshot;
}

const cache = new Map<string, LocatorMetaEntry>();

/**
 * 连接段指纹：以「连接标识」打头，便于按连接前缀整体清理。
 * 段间用 `~` 连接（不用 `|`），保证 key 里的第一个 `|` 永远是连接段与库名段的分隔符。
 * 刻意不含密码等敏感信息。
 */
const buildConnectionKey = (config: any): string => {
    const source = config || {};
    return [
        source.connId || source.id || source.name || '',
        source.dbType || source.type || source.driver || '',
        source.host || '',
        source.port ?? '',
        source.user || source.username || '',
    ]
        .map((segment: any) => String(segment ?? '').trim())
        .join('~');
};

/**
 * 构造稳定缓存 key：连接指纹 + 库 + 表。
 * @param config 连接配置（resolveQueryLocatorPlan 的 config 参数）
 * @param dbName 元数据库名（tableRef.metadataDbName）
 * @param tableName 元数据表名（tableRef.metadataTableName）
 */
export const getLocatorMetaCacheKey = (config: any, dbName: string, tableName: string): string => (
    `${buildConnectionKey(config)}|${String(dbName || '')}|${String(tableName || '')}`
);

/** 取出 key 里的连接段（第一个 `|` 之前）。 */
const readConnectionKey = (key: string): string => {
    const separator = key.indexOf('|');
    return separator < 0 ? key : key.slice(0, separator);
};

/**
 * 读取缓存：命中且未过期返回快照；过期或未命中返回 null（顺手清掉过期项）。
 * @param now 注入当前时间（测试用），默认 Date.now()
 */
export const getLocatorMetaCached = (key: string, now: number = Date.now()): LocatorMetaSnapshot | null => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (now - entry.ts > LOCATOR_META_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.snapshot;
};

/** 写入缓存；超出上限时按插入序淘汰最旧条目。首次写入时顺带挂上失效监听。 */
export const setLocatorMetaCached = (
    key: string,
    snapshot: LocatorMetaSnapshot,
    now: number = Date.now(),
): void => {
    ensureLocatorMetaCacheInvalidationListener();
    cache.set(key, { ts: now, snapshot });
    while (cache.size > LOCATOR_META_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
};

/** 清空缓存（测试用）。 */
export const clearLocatorMetaCache = (): void => {
    cache.clear();
};

/**
 * 按连接清理：结构变更（DDL）后主键/索引可能已变，必须丢掉落后的快照，
 * 否则回写定位会拿着陈旧元数据。
 * @param connectionId 连接 id（conn.config.id）
 * @param dbName 可选：只清该库下的条目；省略则清该连接全部
 */
export const clearLocatorMetaCacheByConnection = (connectionId: string, dbName?: string): void => {
    const target = String(connectionId || '').trim();
    if (!target) return;
    const dbSuffix = dbName === undefined ? null : `|${String(dbName || '')}|`;
    const staleKeys: string[] = [];
    cache.forEach((_entry, key) => {
        const connectionKey = readConnectionKey(key);
        if (connectionKey !== target && !connectionKey.startsWith(`${target}~`)) return;
        if (dbSuffix !== null && !key.includes(dbSuffix)) return;
        staleKeys.push(key);
    });
    staleKeys.forEach((key) => cache.delete(key));
};

/** 仅供测试：当前条目数 / 是否已挂监听。 */
export const __getLocatorMetaCacheSize = (): number => cache.size;

let invalidationListener: ((event: Event) => void) | null = null;
let invalidationListenerTarget: any = null;

/**
 * 挂 DDL 失效钩子。
 *
 * 选择监听既有的 `gonavi:sidebar-database-refresh` 事件，而不是去执行路径里插一行：
 * 该事件正是「结构可能已变」的统一信号——执行路径判定语句为 DDL 并成功后即派发它
 * （queryEditorSqlRun.ts 的 schemaInvalidationStatements 分支），表设计器的索引编辑
 * 也派发同一个事件。这样 DDL 失效不需要改动执行路径文件，也不会漏掉其它入口。
 * 延迟到首次写入时才挂，避免纯导入即产生全局副作用。
 */
export const ensureLocatorMetaCacheInvalidationListener = (): void => {
    if (typeof window === 'undefined') return;
    // 目标 window 变了（测试里 stubGlobal 会整体换掉 window）就必须重挂，
    // 否则监听留在旧对象上，失效钩子从此静默失效。
    if (invalidationListener && invalidationListenerTarget === window) return;
    uninstallLocatorMetaCacheInvalidationListener();
    const listener = (event: Event) => {
        const request = normalizeSidebarDatabaseRefreshRequest((event as CustomEvent).detail);
        if (!request) return;
        clearLocatorMetaCacheByConnection(request.connectionId, request.dbName);
    };
    invalidationListener = listener;
    invalidationListenerTarget = window;
    window.addEventListener(SIDEBAR_DATABASE_REFRESH_EVENT, listener);
};

/** 摘掉失效监听（测试用，避免用例之间互相污染）。 */
export const uninstallLocatorMetaCacheInvalidationListener = (): void => {
    if (invalidationListener && invalidationListenerTarget) {
        invalidationListenerTarget.removeEventListener?.(SIDEBAR_DATABASE_REFRESH_EVENT, invalidationListener);
    }
    invalidationListener = null;
    invalidationListenerTarget = null;
};
