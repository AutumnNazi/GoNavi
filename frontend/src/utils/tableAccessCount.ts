export const MAX_TABLE_ACCESS_COUNT_ENTRIES = 2048;
const TABLE_ACCESS_COUNT_KEY_PREFIX = "v2:";

const normalizeTableAccessCount = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.min(Math.trunc(parsed), Number.MAX_SAFE_INTEGER);
};

export const buildTableAccessCountKey = (
  connectionId: string,
  dbName: string,
  tableName: string,
): string => `${TABLE_ACCESS_COUNT_KEY_PREFIX}${JSON.stringify([
  connectionId,
  dbName,
  tableName,
])}`;

export const buildLegacyTableAccessCountKey = (
  connectionId: string,
  dbName: string,
  tableName: string,
): string => `${connectionId}-${dbName}-${tableName}`;

const parseTableAccessCountKey = (key: string): [string, string, string] | null => {
  if (!key.startsWith(TABLE_ACCESS_COUNT_KEY_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(key.slice(TABLE_ACCESS_COUNT_KEY_PREFIX.length));
    return Array.isArray(parsed)
      && parsed.length === 3
      && parsed.every((part) => typeof part === "string")
      ? parsed as [string, string, string]
      : null;
  } catch {
    return null;
  }
};

export const readTableAccessCount = (
  value: Record<string, number>,
  connectionId: string,
  dbName: string,
  tableName: string,
): number => {
  const current = normalizeTableAccessCount(
    value[buildTableAccessCountKey(connectionId, dbName, tableName)],
  );
  const legacy = normalizeTableAccessCount(
    value[buildLegacyTableAccessCountKey(connectionId, dbName, tableName)],
  );
  return Math.max(current ?? 0, legacy ?? 0);
};

export const sanitizeTableAccessCount = (
  value: unknown,
): Record<string, number> => {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawEntries = Object.entries(raw);
  if (
    !Array.isArray(value)
    && rawEntries.length <= MAX_TABLE_ACCESS_COUNT_ENTRIES
    && rawEntries.every(([, count]) => (
      typeof count === "number"
      && Number.isSafeInteger(count)
      && count >= 0
    ))
  ) {
    return raw as Record<string, number>;
  }

  const entries = rawEntries.flatMap(([key, count], index) => {
    const normalizedCount = normalizeTableAccessCount(count);
    return normalizedCount === null
      ? []
      : [{ key, count: normalizedCount, index }];
  });

  if (entries.length > MAX_TABLE_ACCESS_COUNT_ENTRIES) {
    entries.sort((left, right) => {
      if (left.count !== right.count) {
        return left.count > right.count ? -1 : 1;
      }
      // Object insertion order represents recency: prefer newer entries on ties.
      return right.index - left.index;
    });
    entries.length = MAX_TABLE_ACCESS_COUNT_ENTRIES;
    entries.sort((left, right) => left.index - right.index);
  }

  return Object.fromEntries(entries.map(({ key, count }) => [key, count]));
};

export const incrementTableAccessCount = (
  value: Record<string, number>,
  connectionId: string,
  dbName: string,
  tableName: string,
): Record<string, number> => {
  const source =
    Object.keys(value).length > MAX_TABLE_ACCESS_COUNT_ENTRIES
      ? sanitizeTableAccessCount(value)
      : value;
  const key = buildTableAccessCountKey(connectionId, dbName, tableName);
  const legacyKey = buildLegacyTableAccessCountKey(connectionId, dbName, tableName);
  if (
    Object.prototype.hasOwnProperty.call(source, key)
    || Object.prototype.hasOwnProperty.call(source, legacyKey)
  ) {
    const currentCount = readTableAccessCount(
      source,
      connectionId,
      dbName,
      tableName,
    );
    const next = { ...source };
    // Reinsert the key so insertion order continues to carry recency for ties.
    delete next[key];
    delete next[legacyKey];
    next[key] = Math.min(currentCount + 1, Number.MAX_SAFE_INTEGER);
    return next;
  }

  const entries = Object.entries(source);
  if (entries.length < MAX_TABLE_ACCESS_COUNT_ENTRIES) {
    return { ...source, [key]: 1 };
  }

  let evictionIndex = 0;
  let evictionCount = normalizeTableAccessCount(entries[0]?.[1]) ?? 0;
  for (let index = 1; index < entries.length; index += 1) {
    const candidateCount = normalizeTableAccessCount(entries[index][1]) ?? 0;
    if (candidateCount < evictionCount) {
      evictionIndex = index;
      evictionCount = candidateCount;
    }
  }

  const next: Record<string, number> = {};
  entries.forEach(([entryKey, count], index) => {
    if (index !== evictionIndex) {
      next[entryKey] = count;
    }
  });
  next[key] = 1;
  return next;
};

export const removeConnectionTableAccessCounts = (
  value: Record<string, number>,
  removedConnectionId: string,
  remainingConnectionIds: readonly string[],
): Record<string, number> => {
  const knownConnectionIds = [removedConnectionId, ...remainingConnectionIds];
  const entries = Object.entries(value);
  const retainedEntries = entries.filter(([key]) => {
    const parsed = parseTableAccessCountKey(key);
    if (parsed) {
      return parsed[0] !== removedConnectionId;
    }
    const legacyMatches = knownConnectionIds.filter(
      (connectionId) => connectionId && key.startsWith(`${connectionId}-`),
    );
    // Legacy keys are ambiguous when multiple connection ids match. Keep those
    // conservatively so deleting one connection cannot erase another's count.
    return legacyMatches.length !== 1
      || legacyMatches[0] !== removedConnectionId;
  });
  return retainedEntries.length === entries.length
    ? value
    : Object.fromEntries(retainedEntries);
};
