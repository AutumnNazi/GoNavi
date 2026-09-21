/**
 * Redis sidebar overview aggregation.
 *
 * Why this lives here: the sidebar already walks every Redis database when it
 * expands a connection, and each `redis-db` node carries its key count from that
 * same `INFO keyspace` / `DBSIZE` round trip. Summing them for a header costs
 * zero extra requests, which is the same "statistics ride along" shape the Nacos
 * group badge uses.
 *
 * Pure functions only, so the aggregation rules stay unit-testable without a DOM.
 */

export type RedisSidebarOverview = {
  /** Total keys across every database the connection exposes. */
  totalKeys: number;
  /** Databases that reported at least one key. */
  usedDatabases: number;
  /** Databases the connection exposes, used or not. */
  totalDatabases: number;
};

/**
 * Read a database's key count, preserving "measured as empty" as distinct from
 * "never measured".
 *
 * Returns `0` when the backend positively reported zero keys, and `undefined`
 * when there is no trustworthy number at all. Callers must render those two
 * cases differently: a measured-empty database is a fact worth showing, whereas
 * an absent count is not a fact about the database at all.
 *
 * The distinction is not cosmetic. `RedisGetDatabases` builds its rows from
 * `INFO keyspace`, and in cluster mode fabricates placeholder rows the backend
 * itself never measured; it also falls back to `0` for the whole connection when
 * a node errors (see `internal/redis/redis_impl.go`). Collapsing all of those to
 * a blank cell presents "we could not read this" as "there is nothing here".
 *
 * Only actual numbers and numeric strings are accepted, so `null`, `''` and
 * missing fields stay unknown instead of silently coercing to `0` — `Number()`
 * would otherwise turn every one of them into a measured empty database.
 */
export const resolveRedisDbKeyCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
};

/**
 * Fold a possibly-unknown count into a sum, treating "never measured" as
 * contributing nothing rather than propagating `NaN` into the total.
 */
const toFiniteCount = (value: unknown): number => resolveRedisDbKeyCount(value) ?? 0;

/**
 * Fold a Redis connection's already-loaded `redis-db` children into a header
 * summary, or return null when there is nothing trustworthy to show.
 *
 * Returning null is deliberate and follows the Nacos badge precedent: an
 * unexpanded connection has no counts yet, and rendering "0 keys" there would
 * report an empty database as a fact rather than as "not measured yet". Callers
 * must hide the header entirely instead of substituting zeros.
 */
export const foldRedisSidebarOverview = (
  children: ReadonlyArray<{ type?: unknown; dataRef?: { redisKeyCount?: unknown } }> | null | undefined,
): RedisSidebarOverview | null => {
  if (!Array.isArray(children) || children.length === 0) return null;

  let totalKeys = 0;
  let usedDatabases = 0;
  let totalDatabases = 0;
  for (const child of children) {
    if (!child || child.type !== 'redis-db') continue;
    totalDatabases += 1;
    const keys = toFiniteCount(child.dataRef?.redisKeyCount);
    totalKeys += keys;
    if (keys > 0) usedDatabases += 1;
  }

  // Children existed but none were Redis databases: not our shape to describe.
  if (totalDatabases === 0) return null;
  return { totalKeys, usedDatabases, totalDatabases };
};

/** True when the connection is a Redis host, i.e. the workbench this summary is for. */
export const isRedisConnection = (connection: { config?: { type?: unknown } } | null | undefined): boolean => (
  String(connection?.config?.type || '') === 'redis'
);

/**
 * Find the loaded children of a connection node by key.
 *
 * A connection node only carries children once it has been expanded and its
 * loader resolved; until then this correctly reports "not measured".
 */
export const findConnectionChildren = (
  nodes: ReadonlyArray<any> | null | undefined,
  connectionId: string,
): any[] | null => {
  if (!Array.isArray(nodes) || !connectionId) return null;
  for (const node of nodes) {
    if (!node) continue;
    if (node.type === 'connection' && String(node.key) === connectionId) {
      return Array.isArray(node.children) ? node.children : null;
    }
    // Connection groups nest their connections one level down.
    if (Array.isArray(node.children)) {
      const nested = findConnectionChildren(node.children, connectionId);
      if (nested) return nested;
    }
  }
  return null;
};
