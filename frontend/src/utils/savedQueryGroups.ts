import type { SavedQueryGroup } from '../types';

const QUERY_TOKEN_PREFIX = 'query:';
const GROUP_TOKEN_PREFIX = 'group:';

const toTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
};

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.reduce<string[]>((result, item) => {
    const next = toTrimmedString(item);
    if (!next || seen.has(next)) return result;
    seen.add(next);
    result.push(next);
    return result;
  }, []);
};

export const buildSavedQueryGroupQueryToken = (queryId: string): string => (
  `${QUERY_TOKEN_PREFIX}${String(queryId || '').trim()}`
);

export const buildSavedQueryGroupToken = (groupId: string): string => (
  `${GROUP_TOKEN_PREFIX}${String(groupId || '').trim()}`
);

export const getSavedQueryIdFromGroupToken = (token: string): string => (
  token.startsWith(QUERY_TOKEN_PREFIX) ? token.slice(QUERY_TOKEN_PREFIX.length) : ''
);

export const getSavedQueryGroupIdFromToken = (token: string): string => (
  token.startsWith(GROUP_TOKEN_PREFIX) ? token.slice(GROUP_TOKEN_PREFIX.length) : ''
);

export const isSavedQueryGroupQueryToken = (token: string): boolean => (
  getSavedQueryIdFromGroupToken(token) !== ''
);

export const isSavedQueryGroupToken = (token: string): boolean => (
  getSavedQueryGroupIdFromToken(token) !== ''
);

const sanitizeChildOrder = (value: unknown): string[] => (
  sanitizeStringArray(value).filter((token) => (
    isSavedQueryGroupQueryToken(token) || isSavedQueryGroupToken(token)
  ))
);

const hasParentCycle = (group: SavedQueryGroup, groupById: Map<string, SavedQueryGroup>): boolean => {
  const seen = new Set<string>([group.id]);
  let parentId = String(group.parentGroupId || '').trim();
  while (parentId) {
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    parentId = String(groupById.get(parentId)?.parentGroupId || '').trim();
  }
  return false;
};

/**
 * Defensively normalizes backend responses before they enter UI state. The
 * backend owns persistence, but stale or manually edited JSON must not cause
 * duplicate SQL entries or recursive sidebar rendering.
 */
export const normalizeSavedQueryGroups = (
  value: unknown,
  knownQueryIds?: Iterable<string>,
): SavedQueryGroup[] => {
  if (!Array.isArray(value)) return [];

  const groups: SavedQueryGroup[] = [];
  const seenGroupIds = new Set<string>();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const raw = entry as Record<string, unknown>;
    const id = toTrimmedString(raw.id);
    if (!id || seenGroupIds.has(id)) return;
    seenGroupIds.add(id);
    groups.push({
      id,
      name: toTrimmedString(raw.name) || `Group ${index + 1}`,
      parentGroupId: toTrimmedString(raw.parentGroupId) || undefined,
      queryIds: sanitizeStringArray(raw.queryIds),
      childOrder: sanitizeChildOrder(raw.childOrder),
    });
  });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  groups.forEach((group) => {
    const parentId = String(group.parentGroupId || '').trim();
    if (!parentId || parentId === group.id || !groupById.has(parentId)) {
      group.parentGroupId = undefined;
    }
  });
  groups.forEach((group) => {
    if (hasParentCycle(group, groupById)) {
      group.parentGroupId = undefined;
    }
  });

  const allowedQueryIds = knownQueryIds ? new Set(knownQueryIds) : undefined;
  const ownedQueryIds = new Set<string>();
  groups.forEach((group) => {
    group.queryIds = group.queryIds.filter((queryId) => {
      if ((allowedQueryIds && !allowedQueryIds.has(queryId)) || ownedQueryIds.has(queryId)) {
        return false;
      }
      ownedQueryIds.add(queryId);
      return true;
    });
  });

  return groups.map((group) => {
    const directChildGroupIds = groups
      .filter((candidate) => candidate.parentGroupId === group.id)
      .map((candidate) => candidate.id);
    const defaultOrder = [
      ...group.queryIds.map(buildSavedQueryGroupQueryToken),
      ...directChildGroupIds.map(buildSavedQueryGroupToken),
    ];
    const validTokens = new Set(defaultOrder);
    const usedTokens = new Set<string>();
    const childOrder = [...(group.childOrder || []), ...defaultOrder].filter((token) => {
      if (!validTokens.has(token) || usedTokens.has(token)) return false;
      usedTokens.add(token);
      return true;
    });
    return {
      ...group,
      queryIds: childOrder
        .filter(isSavedQueryGroupQueryToken)
        .map(getSavedQueryIdFromGroupToken),
      childOrder,
    };
  });
};

export const getSavedQueryGroupOwnerIds = (
  groups: SavedQueryGroup[],
): Map<string, string> => {
  const owners = new Map<string, string>();
  groups.forEach((group) => {
    group.queryIds.forEach((queryId) => {
      if (!owners.has(queryId)) owners.set(queryId, group.id);
    });
  });
  return owners;
};

export const getSavedQueryGroupDescendantIds = (
  groups: SavedQueryGroup[],
  rootGroupId: string,
): Set<string> => {
  const descendants = new Set<string>();
  const pending = [rootGroupId];
  while (pending.length > 0) {
    const parentGroupId = pending.pop();
    if (!parentGroupId) continue;
    groups.forEach((group) => {
      if (group.parentGroupId !== parentGroupId || descendants.has(group.id)) return;
      descendants.add(group.id);
      pending.push(group.id);
    });
  }
  return descendants;
};

export const buildSavedQueryGroupPath = (
  groupId: string,
  groups: SavedQueryGroup[],
): string[] => {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = groupById.get(groupId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.name || current.id);
    current = current.parentGroupId ? groupById.get(current.parentGroupId) : undefined;
  }
  return path;
};

export const buildSavedQueryGroupParentOptions = (
  groups: SavedQueryGroup[],
  editingGroupId = '',
): Array<{ value: string; label: string }> => {
  const excludedIds = editingGroupId
    ? new Set([editingGroupId, ...getSavedQueryGroupDescendantIds(groups, editingGroupId)])
    : new Set<string>();
  return groups
    .filter((group) => !excludedIds.has(group.id))
    .map((group) => ({
      value: group.id,
      label: buildSavedQueryGroupPath(group.id, groups).join(' / ') || group.name,
    }));
};

export const resolveSavedQueryGroupChildOrder = (
  groupId: string,
  groups: SavedQueryGroup[],
): string[] => {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  const defaults = [
    ...group.queryIds.map(buildSavedQueryGroupQueryToken),
    ...groups
      .filter((candidate) => candidate.parentGroupId === groupId)
      .map((candidate) => buildSavedQueryGroupToken(candidate.id)),
  ];
  const validTokens = new Set(defaults);
  const seen = new Set<string>();
  return [...(group.childOrder || []), ...defaults].filter((token) => {
    if (!validTokens.has(token) || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
};
