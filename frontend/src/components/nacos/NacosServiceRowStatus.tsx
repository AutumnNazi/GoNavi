import React from 'react';

import { t } from '../../i18n';
import { parseNacosServiceName } from '../nacosServiceName';

export type NacosServiceSummaryLike = {
  name?: unknown;
  groupName?: unknown;
  instanceCount?: unknown;
  healthyInstanceCount?: unknown;
  statisticsAvailable?: unknown;
};

/** Page shape emitted by the Nacos service list when statistics were requested. */
export type NacosServiceStatisticsPage = {
  serviceNames?: unknown[];
  services?: unknown[];
  statisticsAvailable?: unknown;
};

/** Per-service statistics keyed by the qualified `GROUP@@service` name. */
export const buildNacosServiceStatisticsIndex = (
  page: NacosServiceStatisticsPage | null | undefined,
): Map<string, NacosServiceSummaryLike> => {
  const index = new Map<string, NacosServiceSummaryLike>();
  const summaries = Array.isArray(page?.services) ? page.services : [];
  for (const rawSummary of summaries) {
    const summary = (rawSummary || {}) as NacosServiceSummaryLike;
    const name = String(summary.name ?? '').trim();
    if (!name) continue;
    const group = String(summary.groupName ?? '').trim() || 'DEFAULT_GROUP';
    index.set(`${group}@@${name}`, summary);
  }
  return index;
};

const toCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * Inline online-state cell for one row of the Nacos service list.
 *
 * This is the placement the originating issue asked for most directly ("列表页面
 * 就可以看到状态信息"): the user should not have to open a service to learn
 * whether it is serving traffic. It renders nothing when the Nacos server does not
 * report instance statistics, so the column degrades to empty instead of showing a
 * wall of fabricated "offline" rows.
 */
const NacosServiceRowStatus = React.memo(({
  rawName,
  summary,
}: {
  rawName: string;
  summary?: NacosServiceSummaryLike | null;
}) => {
  if (!summary || !summary.statisticsAvailable) return null;

  const identity = parseNacosServiceName(rawName);
  const instances = toCount(summary.instanceCount);
  const healthy = toCount(summary.healthyInstanceCount);
  const state = instances <= 0
    ? 'unknown'
    : healthy <= 0
      ? 'down'
      : healthy >= instances
        ? 'ok'
        : 'partial';
  const label = t(`nacos_service.row_health.${state}`, { healthy, total: instances });

  return (
    <span
      className={`gn-nacos-service-row-status is-${state}`}
      data-nacos-service-health={state}
      title={t(`nacos_service.row_health.tooltip.${state}`, {
        healthy,
        total: instances,
        name: identity.serviceName,
      })}
    >
      {label}
    </span>
  );
});

NacosServiceRowStatus.displayName = 'NacosServiceRowStatus';

export default NacosServiceRowStatus;
