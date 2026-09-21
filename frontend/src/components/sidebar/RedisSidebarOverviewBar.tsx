import React from 'react';

import { t } from '../../i18n';
import {
  findConnectionChildren,
  foldRedisSidebarOverview,
  isRedisConnection,
  type RedisSidebarOverview,
} from './redisSidebarOverview';

type RedisSidebarOverviewBarProps = {
  /** The currently active connection, or null when no host is selected. */
  connection: { id?: unknown; config?: { type?: unknown } } | null | undefined;
  /** The sidebar tree; the connection's children are read out of it. */
  treeData: ReadonlyArray<any> | null | undefined;
};

/**
 * Header strip shown in place of the object-kind filter slot when a dedicated
 * Redis workbench is active.
 *
 * Three constraints shape this component:
 *
 * 1. It must fit the slot's fixed 36px height, because that slot exists to keep
 *    the tree's vertical origin stable when switching connections (see
 *    `.gn-v2-explorer-filter-slot`). It therefore renders inline, not as a block.
 *
 * 2. When the connection has not been expanded, the counts genuinely do not exist
 *    yet. `foldRedisSidebarOverview` returns null and this renders nothing, rather
 *    than claiming "0 keys" for a database that was simply never measured.
 *
 * 3. It decides its own applicability from the connection type, so the sidebar
 *    only has to render it — that file is far past the repo's size limit and must
 *    not absorb new branching.
 */
const RedisSidebarOverviewBar = React.memo(({
  connection,
  treeData,
}: RedisSidebarOverviewBarProps) => {
  if (!isRedisConnection(connection)) return null;
  const children = findConnectionChildren(treeData, String(connection?.id || ''));
  const overview: RedisSidebarOverview | null = foldRedisSidebarOverview(children);
  if (!overview) return null;

  const { totalKeys, usedDatabases, totalDatabases } = overview;
  const keysLabel = t('redis_sidebar.overview.total_keys', { count: totalKeys.toLocaleString() });
  const dbsLabel = t('redis_sidebar.overview.databases', {
    used: usedDatabases,
    total: totalDatabases,
  });
  const ariaLabel = `${t('redis_sidebar.overview.aria')}: ${keysLabel}, ${dbsLabel}`;

  return (
    <div
      className="gn-v2-explorer-redis-overview"
      role="status"
      aria-label={ariaLabel}
      data-redis-sidebar-overview="true"
      data-redis-total-keys={totalKeys}
      data-redis-used-dbs={usedDatabases}
      data-redis-total-dbs={totalDatabases}
    >
      <span className="gn-v2-explorer-redis-overview-item">{keysLabel}</span>
      <span className="gn-v2-explorer-redis-overview-item">{dbsLabel}</span>
    </div>
  );
});

RedisSidebarOverviewBar.displayName = 'RedisSidebarOverviewBar';

export default RedisSidebarOverviewBar;
