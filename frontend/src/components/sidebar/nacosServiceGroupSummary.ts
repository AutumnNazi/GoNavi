/**
 * Nacos service-group health summarisation.
 *
 * Why this lives here rather than in the tree loaders or a viewer:
 * `collectNacosServiceGroupsByPage` already walks every page of the namespace's
 * service list just to collect group names. The very same pages carry per-service
 * instance statistics when the Nacos server provides them, so folding them into
 * group aggregates costs zero extra requests. This module holds only pure
 * functions so the aggregation rules stay unit-testable without a DOM.
 */

export const NACOS_GROUP_HEALTH_UNKNOWN = 'unknown';
export const NACOS_GROUP_HEALTH_DOWN = 'down';
export const NACOS_GROUP_HEALTH_PARTIAL = 'partial';
export const NACOS_GROUP_HEALTH_OK = 'ok';

export type NacosGroupHealthState =
  | typeof NACOS_GROUP_HEALTH_UNKNOWN
  | typeof NACOS_GROUP_HEALTH_DOWN
  | typeof NACOS_GROUP_HEALTH_PARTIAL
  | typeof NACOS_GROUP_HEALTH_OK;

/** Per-service statistics as reported by the service list response. */
export type NacosServiceSummary = {
  name?: unknown;
  groupName?: unknown;
  instanceCount?: unknown;
  healthyInstanceCount?: unknown;
  statisticsAvailable?: unknown;
};

export type NacosServicePageWithStatistics = {
  count?: unknown;
  serviceNames?: unknown[];
  services?: unknown[];
  statisticsAvailable?: unknown;
  statisticsFamily?: unknown;
};

export type NacosGroupHealthEntry = {
  groupName: string;
  serviceCount: number;
  instanceCount: number;
  healthyInstanceCount: number;
  /**
   * Number of the group's services that reported zero instances. They contribute
   * nothing to the sums above, so a group can look fully healthy while one of its
   * services serves nothing — see resolveNacosGroupHealthState.
   */
  serviceWithoutInstanceCount: number;
  /** False when any service of the group could not be measured. */
  statisticsAvailable: boolean;
};

export type NacosGroupServiceScan = {
  /** Group name -> service count, available without any statistics support. */
  serviceCounts: Map<string, number>;
  /** Group name -> aggregated health, only for groups that reported statistics. */
  groupHealth: Map<string, NacosGroupHealthEntry>;
  /** True when at least one page reported instance statistics. */
  statisticsAvailable: boolean;
  /** Which Nacos API family supplied the statistics, for diagnostics. */
  statisticsFamily: string;
};

const toFiniteCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

/** Normalise a group name the same way the backend does, defaulting blanks. */
export const normalizeNacosGroupName = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return text || 'DEFAULT_GROUP';
};

const createEmptyScan = (): NacosGroupServiceScan => ({
  serviceCounts: new Map<string, number>(),
  groupHealth: new Map<string, NacosGroupHealthEntry>(),
  statisticsAvailable: false,
  statisticsFamily: '',
});

/**
 * Fold one service-list page into the running scan.
 *
 * Counts always accumulate (they come from the name list, which every Nacos family
 * returns). Health only accumulates when the page reported statistics, and a group
 * that has any unmeasured service is marked unavailable so callers show "unknown"
 * instead of an understated total.
 */
export const foldNacosServiceScanPage = (
  scan: NacosGroupServiceScan,
  page: NacosServicePageWithStatistics | null | undefined,
  parseServiceName: (raw: string) => { groupName: string; serviceName: string },
): NacosGroupServiceScan => {
  const serviceNames = Array.isArray(page?.serviceNames) ? page.serviceNames : [];
  for (const rawName of serviceNames) {
    const identity = parseServiceName(String(rawName ?? ''));
    if (!identity?.serviceName) continue;
    const group = normalizeNacosGroupName(identity.groupName);
    scan.serviceCounts.set(group, (scan.serviceCounts.get(group) || 0) + 1);
  }

  const summaries = Array.isArray(page?.services) ? page.services : [];
  const pageReportsStatistics = summaries.length > 0 && Boolean(page?.statisticsAvailable);
  if (pageReportsStatistics) {
    scan.statisticsAvailable = true;
    if (!scan.statisticsFamily) {
      scan.statisticsFamily = String(page?.statisticsFamily ?? '').trim();
    }
  }

  for (const rawSummary of summaries) {
    const summary = (rawSummary || {}) as NacosServiceSummary;
    const group = normalizeNacosGroupName(summary.groupName);
    const reported = Boolean(summary.statisticsAvailable);
    const existing = scan.groupHealth.get(group) || {
      groupName: group,
      serviceCount: 0,
      instanceCount: 0,
      healthyInstanceCount: 0,
      serviceWithoutInstanceCount: 0,
      statisticsAvailable: true,
    };
    existing.serviceCount += 1;
    if (!reported) {
      // One unmeasured member makes the group total an understatement.
      existing.statisticsAvailable = false;
    } else {
      const instances = toFiniteCount(summary.instanceCount);
      existing.instanceCount += instances;
      existing.healthyInstanceCount += toFiniteCount(summary.healthyInstanceCount);
      if (instances <= 0) {
        // Counted alongside the sums because it cannot be read back out of them: a
        // zero-instance service is invisible in healthy/total, yet it is exactly the
        // "nothing is serving" case the group badge exists to surface.
        existing.serviceWithoutInstanceCount += 1;
      }
    }
    scan.groupHealth.set(group, existing);
  }

  return scan;
};

/** Create a scan accumulator, then feed it pages via {@link foldNacosServiceScanPage}. */
export const createNacosServiceScan = (): NacosGroupServiceScan => createEmptyScan();

/** Stable, locale-independent ordering for group rows. */
export const sortNacosServiceGroups = (groups: Iterable<string>): string[] => (
  Array.from(groups).sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  })
);

/**
 * Resolve the badge state for a group.
 *
 * `unknown` is deliberately distinct from `down`: a group whose services are simply
 * not reported by this Nacos API family must not be painted as "all offline", which
 * would be an actively misleading claim.
 */
export const resolveNacosGroupHealthState = (
  entry: NacosGroupHealthEntry | null | undefined,
): NacosGroupHealthState => {
  if (!entry || !entry.statisticsAvailable || entry.serviceCount <= 0) {
    return NACOS_GROUP_HEALTH_UNKNOWN;
  }
  if (entry.instanceCount <= 0) {
    // A service exists but exposes no instances: nothing is serveable, yet calling
    // it "offline" would imply instances that went unhealthy. Treat as unknown.
    return NACOS_GROUP_HEALTH_UNKNOWN;
  }
  if (entry.serviceWithoutInstanceCount > 0) {
    // The zero-instance services contribute nothing to the sums, so checking the
    // ratios alone would report "all healthy" for a group where part of it serves
    // nothing. `partial` is the honest reading: something in this group is up, but
    // not everything the group claims to expose.
    return NACOS_GROUP_HEALTH_PARTIAL;
  }
  if (entry.healthyInstanceCount <= 0) return NACOS_GROUP_HEALTH_DOWN;
  if (entry.healthyInstanceCount >= entry.instanceCount) return NACOS_GROUP_HEALTH_OK;
  return NACOS_GROUP_HEALTH_PARTIAL;
};
