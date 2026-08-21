import { splitQualifiedNameSegmentsDetailed } from '../../utils/qualifiedName';

export interface SidebarPartitionTableEntry {
  tableName: string;
  schemaName?: string;
  displayName: string;
  partitionParentTableName?: string;
  rowCount?: number;
}

export type GroupedSidebarPartitionTableEntry<T extends SidebarPartitionTableEntry> = T & {
  partitionTables?: GroupedSidebarPartitionTableEntry<T>[];
};

interface GroupSidebarPartitionTableEntriesOptions<T extends SidebarPartitionTableEntry> {
  isEntryVisible?: (entry: T) => boolean;
}

export const getSidebarTableEntryIdentity = (
  entry: Pick<SidebarPartitionTableEntry, 'tableName' | 'schemaName'>,
): string => {
  const tableName = String(entry.tableName || '').trim();
  if (!tableName) return '';
  const segments = splitQualifiedNameSegmentsDetailed(tableName);
  const qualifiedSchemaName = segments.slice(0, -1).map((segment) => segment.raw).join('.');
  const schemaName = String(
    qualifiedSchemaName || entry.schemaName,
  ).trim();
  // Keep raw segments so quoted identifiers are not merged with differently
  // cased unquoted identifiers on PostgreSQL-compatible sources.
  const objectName = String(segments[segments.length - 1]?.raw || tableName).trim();
  return `${schemaName}\u0000${objectName}`;
};

const getSidebarTableObjectIdentity = (tableName: unknown): string => {
  const text = String(tableName || '').trim();
  if (!text) return '';
  const segments = splitQualifiedNameSegmentsDetailed(text);
  return String(segments[segments.length - 1]?.raw || text).trim();
};

// Catalog metadata can contain the same relation more than once. Keep the
// first record so its loaded statistics/comments remain stable for the tree.
export const dedupeSidebarTableEntries = <T extends SidebarPartitionTableEntry>(
  entries: T[],
): T[] => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const identity = getSidebarTableEntryIdentity(entry);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const buildPartitionEntryKey = (
  entry: Pick<SidebarPartitionTableEntry, 'tableName' | 'schemaName'>,
): string => getSidebarTableEntryIdentity(entry);

const buildPartitionParentKey = (
  entry: Pick<SidebarPartitionTableEntry, 'partitionParentTableName' | 'schemaName'>,
): string => {
  const parentTableName = String(entry.partitionParentTableName || '').trim();
  if (!parentTableName) return '';
  return getSidebarTableEntryIdentity({
    tableName: parentTableName,
    schemaName: entry.schemaName,
  });
};

export const groupSidebarPartitionTableEntries = <T extends SidebarPartitionTableEntry>(
  entries: T[],
  options: GroupSidebarPartitionTableEntriesOptions<T> = {},
): GroupedSidebarPartitionTableEntry<T>[] => {
  const groupedEntries = entries
    .filter((entry) => options.isEntryVisible?.(entry) ?? true)
    .map((entry) => ({ ...entry })) as GroupedSidebarPartitionTableEntry<T>[];
  const entryByKey = new Map<string, GroupedSidebarPartitionTableEntry<T>>();
  const entryByUnqualifiedObjectKey = new Map<
    string,
    GroupedSidebarPartitionTableEntry<T> | null
  >();

  groupedEntries.forEach((entry) => {
    const key = buildPartitionEntryKey(entry);
    if (key && !entryByKey.has(key)) entryByKey.set(key, entry);

    const objectKey = getSidebarTableObjectIdentity(entry.tableName);
    if (!objectKey) return;
    if (!entryByUnqualifiedObjectKey.has(objectKey)) {
      entryByUnqualifiedObjectKey.set(objectKey, entry);
    } else {
      entryByUnqualifiedObjectKey.set(objectKey, null);
    }
  });

  const directParentByEntry = new Map<
    GroupedSidebarPartitionTableEntry<T>,
    GroupedSidebarPartitionTableEntry<T>
  >();
  groupedEntries.forEach((entry) => {
    const parentTableName = String(entry.partitionParentTableName || '').trim();
    const parentKey = buildPartitionParentKey(entry);
    let parent = parentKey ? entryByKey.get(parentKey) : undefined;
    // Some catalogs omit schema_name on both table and partition rows. Fall
    // back only when the unqualified parent has one unambiguous candidate;
    // ambiguous names remain visible at the root instead of crossing schemas.
    if (!parent && !entry.schemaName && parentTableName
      && splitQualifiedNameSegmentsDetailed(parentTableName).length === 1) {
      const candidate = entryByUnqualifiedObjectKey.get(
        getSidebarTableObjectIdentity(parentTableName),
      );
      if (candidate && candidate !== entry) parent = candidate;
    }
    if (parent) directParentByEntry.set(entry, parent);
  });

  const createsCycle = (
    child: GroupedSidebarPartitionTableEntry<T>,
    parent: GroupedSidebarPartitionTableEntry<T>,
  ): boolean => {
    const seen = new Set<GroupedSidebarPartitionTableEntry<T>>([child]);
    let current: GroupedSidebarPartitionTableEntry<T> | undefined = parent;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = directParentByEntry.get(current);
    }
    return false;
  };

  const nestedEntries = new Set<GroupedSidebarPartitionTableEntry<T>>();
  groupedEntries.forEach((entry) => {
    const parent = directParentByEntry.get(entry);
    if (!parent || createsCycle(entry, parent)) return;
    parent.partitionTables = [...(parent.partitionTables || []), entry];
    delete parent.rowCount;
    nestedEntries.add(entry);
  });

  return groupedEntries.filter((entry) => !nestedEntries.has(entry));
};
