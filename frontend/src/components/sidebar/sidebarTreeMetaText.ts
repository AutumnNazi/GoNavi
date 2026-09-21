/**
 * The trailing number on a sidebar tree row.
 *
 * Extracted from `useSidebarV2ContextMenu` so the per-node-kind rules can be
 * exercised directly. They used to sit inside a hook that the sidebar's SSR test
 * harness never mounts, so mutating them changed what users see without turning
 * a single test red — verified by mutation, see
 * `docs/需求追踪/需求进度追踪-Redis侧栏概览条-20260921.md` §7.
 *
 * The rule shared by every branch: a count shows when it was measured —
 * including a measured zero — and stays blank when it was not. A blank cell
 * therefore means "not measured", never "empty".
 */

import { resolveRedisDbKeyCount } from './redisSidebarOverview';

export type SidebarTreeMetaSources = {
  /**
   * Connections counted under a tag row.
   *
   * Lazy on purpose: this walks the subtree, and the caller runs in
   * `titleRender`, which fires for every visible row on every render. Resolving
   * it eagerly would make every table row pay for a full tag walk.
   */
  countTagConnections: () => number;
  /** Objects counted under an `object-group` row. Lazy for the same reason. */
  countObjectGroupObjects: () => number;
  /** Row-count formatting; the sidebar owns the locale-dependent short forms. */
  formatRowCount: (rowCount: number) => string;
};

export const resolveSidebarTreeMetaText = (
  node: any,
  sources: SidebarTreeMetaSources,
): string => {
  if (!node) return '';

  if (node.type === 'tag') {
    const count = sources.countTagConnections();
    return count > 0 ? count.toLocaleString() : '';
  }

  // Database rows show no count: the "表" object group below already does.
  if (node.type === 'object-group') {
    const count = sources.countObjectGroupObjects();
    return count > 0 ? count.toLocaleString() : '';
  }

  if (node.type === 'redis-db') {
    // An empty database still gets its "0": the count came back, it just happens
    // to be zero. Only an unmeasured database (the loader never set
    // `redisKeyCount`) renders blank, so "this database is empty" stops looking
    // identical to "this row's count is missing".
    //
    // Note what a zero can also mean here. In cluster mode the backend fabricates
    // all 16 logical databases but only ever measures db0 — db1..db15 are
    // placeholders that are structurally zero (`internal/redis/redis_impl.go`).
    // A "0" on those reads as "not applicable for a cluster", not "no keys".
    const keyCount = resolveRedisDbKeyCount(node?.dataRef?.redisKeyCount);
    return keyCount === undefined ? '' : keyCount.toLocaleString();
  }

  if (node.type === 'table') {
    const rowCount = Number(node?.dataRef?.rowCount);
    return Number.isFinite(rowCount) && rowCount >= 0 ? sources.formatRowCount(rowCount) : '';
  }

  return '';
};
