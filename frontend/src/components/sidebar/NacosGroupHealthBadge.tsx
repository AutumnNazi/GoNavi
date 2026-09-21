import React from 'react';

import { t } from '../../i18n';
import {
  NACOS_GROUP_HEALTH_DOWN,
  NACOS_GROUP_HEALTH_OK,
  NACOS_GROUP_HEALTH_PARTIAL,
  NACOS_GROUP_HEALTH_UNKNOWN,
  resolveNacosGroupHealthState,
  type NacosGroupHealthEntry,
} from './nacosServiceGroupSummary';

type NacosGroupHealthBadgeProps = {
  entry: NacosGroupHealthEntry | null | undefined;
  /** Whether the Nacos server reported instance statistics at all. */
  statisticsAvailable: boolean;
};

const BADGE_LABEL_KEYS: Record<string, string> = {
  [NACOS_GROUP_HEALTH_OK]: 'nacos_service.group.badge.online',
  [NACOS_GROUP_HEALTH_PARTIAL]: 'nacos_service.group.badge.partial',
  [NACOS_GROUP_HEALTH_DOWN]: 'nacos_service.group.badge.down',
  [NACOS_GROUP_HEALTH_UNKNOWN]: 'nacos_service.group.badge.unknown',
};

const TOOLTIP_KEYS: Record<string, string> = {
  [NACOS_GROUP_HEALTH_OK]: 'nacos_service.group.tooltip.online',
  [NACOS_GROUP_HEALTH_PARTIAL]: 'nacos_service.group.tooltip.partial',
  [NACOS_GROUP_HEALTH_DOWN]: 'nacos_service.group.tooltip.down',
  [NACOS_GROUP_HEALTH_UNKNOWN]: 'nacos_service.group.tooltip.unknown',
};

/**
 * A group can be `partial` for two unrelated reasons, and only one of them is
 * visible in the instance ratio: some instances are unhealthy, or some services
 * registered no instances at all. The second case still reads "2/2 healthy" from
 * the ratio, so it gets its own label and tooltip that talk about services.
 */
const EMPTY_SERVICE_BADGE_KEY = 'nacos_service.group.badge.partial_empty_services';
const EMPTY_SERVICE_TOOLTIP_KEY = 'nacos_service.group.tooltip.partial_empty_services';

/**
 * Aggregated "how much of this group is actually serveable" badge for a Nacos
 * service group row.
 *
 * Kept as a memoized leaf outside the tree-title render path on purpose: rc-tree
 * asks titleRender for every row entering the virtual window while scrolling, so
 * this must stay a cheap span and never a Tooltip subtree (see the
 * SidebarTableHoverInfo precedent in SidebarTreeTitle.tsx).
 *
 * When the Nacos server does not report instance statistics for the namespace
 * (v2/v3 response shapes that return bare service names), the badge renders
 * nothing at all rather than a column of "unknown" rows — the count pill still
 * tells the user how many services live in the group.
 */
const NacosGroupHealthBadge = React.memo(({
  entry,
  statisticsAvailable,
}: NacosGroupHealthBadgeProps) => {
  const state = resolveNacosGroupHealthState(entry);
  if (state === NACOS_GROUP_HEALTH_UNKNOWN && !statisticsAvailable) return null;

  const total = entry?.instanceCount ?? 0;
  const healthy = entry?.healthyInstanceCount ?? 0;
  const emptyServices = entry?.serviceWithoutInstanceCount ?? 0;
  const services = entry?.serviceCount ?? 0;
  // Only meaningful when the state came from the empty-service branch: with unhealthy
  // instances the instance ratio is the honest story, so partial keeps its own wording.
  const emptyServiceDriven = state === NACOS_GROUP_HEALTH_PARTIAL
    && emptyServices > 0
    && healthy >= total;
  const labelKey = emptyServiceDriven ? EMPTY_SERVICE_BADGE_KEY : BADGE_LABEL_KEYS[state];
  const tooltipKey = emptyServiceDriven ? EMPTY_SERVICE_TOOLTIP_KEY : TOOLTIP_KEYS[state];
  const params = { healthy, total, empty: emptyServices, services };
  const label = state === NACOS_GROUP_HEALTH_UNKNOWN ? t(labelKey) : t(labelKey, params);
  const tooltip = t(tooltipKey, params);

  return (
    <span
      className={`gn-v2-tree-nacos-health is-${state}`}
      data-sidebar-nacos-group-health={state}
      title={tooltip}
    >
      {label}
    </span>
  );
});

NacosGroupHealthBadge.displayName = 'NacosGroupHealthBadge';

export default NacosGroupHealthBadge;
