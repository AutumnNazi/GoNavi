export type NacosServiceIdentity = {
  groupName: string;
  serviceName: string;
};

export type NacosServiceNamePage = {
  count?: number;
  serviceNames?: unknown[];
};

export type NacosServiceNamePageFetcher = (
  pageNo: number,
  pageSize: number,
) => Promise<NacosServiceNamePage | null | undefined>;

export const NACOS_SERVICE_GROUP_PAGE_SIZE = 500;

export const parseNacosServiceName = (raw: string): NacosServiceIdentity => {
  const text = String(raw || '').trim();
  const separator = text.indexOf('@@');
  if (separator >= 0) {
    const groupName = text.slice(0, separator).trim() || 'DEFAULT_GROUP';
    const serviceName = text.slice(separator + 2).trim();
    return { groupName, serviceName: serviceName || text };
  }
  return { groupName: 'DEFAULT_GROUP', serviceName: text };
};

const sortNacosServiceGroups = (groups: Iterable<string>): string[] => (
  Array.from(groups).sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  })
);

export const collectNacosServiceGroupsByPage = async (
  fetchPage: NacosServiceNamePageFetcher,
  pageSize = NACOS_SERVICE_GROUP_PAGE_SIZE,
): Promise<string[]> => {
  const groups = new Set<string>();
  await walkNacosServicePages(fetchPage, pageSize, (page) => {
    const serviceNames = Array.isArray(page?.serviceNames) ? page.serviceNames : [];
    for (const rawName of serviceNames) {
      const identity = parseNacosServiceName(String(rawName ?? ''));
      if (identity.serviceName) {
        groups.add(identity.groupName);
      }
    }
  });
  return sortNacosServiceGroups(groups);
};

/**
 * Walk every page of the namespace service list, handing each page to `onPage`.
 *
 * Split out of {@link collectNacosServiceGroupsByPage} because that scan is already
 * paid for — the pages it reads carry per-service instance statistics on the Nacos
 * versions that report them, so callers folding health data reuse this walk instead
 * of issuing a second, independent scan.
 */
export const walkNacosServicePages = async (
  fetchPage: NacosServiceNamePageFetcher,
  pageSize: number,
  onPage: (page: NacosServiceNamePage | null | undefined) => void,
): Promise<void> => {
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : NACOS_SERVICE_GROUP_PAGE_SIZE;
  let pageNo = 1;
  let loadedServiceCount = 0;

  while (true) {
    const page = await fetchPage(pageNo, normalizedPageSize);
    onPage(page);
    const serviceNames = Array.isArray(page?.serviceNames) ? page.serviceNames : [];

    loadedServiceCount += serviceNames.length;
    const total = Number(page?.count);
    const reachedTotal = Number.isFinite(total) && total >= 0 && loadedServiceCount >= total;
    if (serviceNames.length === 0 || reachedTotal) {
      break;
    }
    pageNo += 1;
  }
};
