import type { ColumnDefinition, IndexDefinition } from '../types';
import { resolveUniqueKeyGroupsFromIndexes } from './dataGridCopyInsert';
import { buildColumnMetaMap, type ColumnMeta } from './dataGridColumnMeta';

export type DataGridColumnIndexKey = 'PRI' | 'UNI' | 'MUL';
export type DataGridColumnTypeRole = 'pk' | 'unique' | 'fk' | 'index' | 'none';
export type DataGridIndexedColumnMetadata = {
  columnMetaMap?: Record<string, ColumnMeta>;
  uniqueKeyGroups?: string[][];
};

export const DATA_GRID_COLUMN_TYPE_ROLE_TOOLTIP_KEY: Record<
  Exclude<DataGridColumnTypeRole, 'none' | 'fk'>,
  string
> = {
  pk: 'data_grid.column.primary_key_tooltip',
  unique: 'data_grid.column.unique_key_tooltip',
  index: 'data_grid.column.index_tooltip',
};

const COLUMN_INDEX_KEY_RANK: Record<string, number> = {
  PRI: 0,
  UNI: 1,
  MUL: 2,
};

const readIndexField = (value: unknown, keys: string[]): string => {
  const source = value as Record<string, unknown> | null | undefined;
  if (!source || typeof source !== 'object') return '';

  for (const key of keys) {
    const raw = source[key];
    if (raw !== undefined && raw !== null && String(raw).trim()) {
      return String(raw).trim();
    }
  }

  for (const [sourceKey, raw] of Object.entries(source)) {
    if (!keys.some((key) => sourceKey.toLowerCase() === key.toLowerCase())) continue;
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim();
    if (text) return text;
  }

  return '';
};

const normalizeColumnIndexKey = (value: unknown): DataGridColumnIndexKey | '' => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'PRI' || normalized === 'PK' || normalized === 'PRIMARY' || normalized === 'PRIMARY KEY') {
    return 'PRI';
  }
  if (normalized === 'UNI' || normalized === 'UNIQUE') return 'UNI';
  if (normalized === 'MUL' || normalized === 'INDEX' || normalized === 'IDX' || normalized === 'MULTIPLE') {
    return 'MUL';
  }
  return '';
};

const pickStrongerColumnIndexKey = (
  current: string | undefined,
  candidate: DataGridColumnIndexKey | '',
): string => {
  const left = normalizeColumnIndexKey(current);
  const right = normalizeColumnIndexKey(candidate);
  if (!right) return left;
  if (!left) return right;
  return (COLUMN_INDEX_KEY_RANK[right] ?? 9) < (COLUMN_INDEX_KEY_RANK[left] ?? 9) ? right : left;
};

const isPrimaryIndexName = (name: string, indexType: string): boolean => {
  const normalizedName = name.trim().toLowerCase();
  const normalizedType = indexType.trim().toLowerCase();
  return normalizedName === 'primary'
    || normalizedName === 'primary key'
    || normalizedName.endsWith('_pkey')
    || normalizedType === 'primary'
    || normalizedType === 'primary key';
};

export const resolveDataGridColumnTypeRole = (input: {
  key?: string | null;
  hasForeignKey?: boolean;
}): DataGridColumnTypeRole => {
  const key = normalizeColumnIndexKey(input.key);
  if (key === 'PRI') return 'pk';
  if (key === 'UNI') return 'unique';
  if (input.hasForeignKey) return 'fk';
  if (key === 'MUL') return 'index';
  return 'none';
};

export const resolveIndexColumnKeys = (indexes: unknown[] | undefined): Record<string, DataGridColumnIndexKey> => {
  const result: Record<string, DataGridColumnIndexKey> = {};
  const uniqueNames = new Set(
    resolveUniqueKeyGroupsFromIndexes(indexes as IndexDefinition[])
      .flat()
      .map((columnName) => columnName.toLowerCase()),
  );

  (indexes || []).forEach((index) => {
    const columnName = readIndexField(index, ['columnName', 'ColumnName', 'column_name', 'COLUMN_NAME']);
    if (!columnName) return;
    const lowerName = columnName.toLowerCase();
    const indexName = readIndexField(index, ['name', 'Name', 'indexName', 'index_name', 'INDEX_NAME']);
    const indexType = readIndexField(index, ['indexType', 'IndexType', 'index_type', 'INDEX_TYPE']);
    const unique = uniqueNames.has(lowerName);
    const nextKey: DataGridColumnIndexKey = unique && isPrimaryIndexName(indexName, indexType)
      ? 'PRI'
      : unique
        ? 'UNI'
        : 'MUL';
    const current = result[lowerName];
    result[lowerName] = pickStrongerColumnIndexKey(current, nextKey) as DataGridColumnIndexKey;
  });

  return result;
};

export const applyIndexColumnKeysToColumnMetaMap = (
  metaMap: Record<string, ColumnMeta>,
  indexKeys: Record<string, DataGridColumnIndexKey> | undefined,
): Record<string, ColumnMeta> => {
  if (!metaMap || !indexKeys || Object.keys(indexKeys).length === 0) {
    return metaMap;
  }

  let changed = false;
  const nextMap: Record<string, ColumnMeta> = {};
  Object.entries(metaMap).forEach(([name, meta]) => {
    const mergedKey = pickStrongerColumnIndexKey(meta?.key, indexKeys[name.toLowerCase()] || '');
    if (mergedKey !== String(meta?.key || '')) {
      changed = true;
      nextMap[name] = { ...meta, key: mergedKey };
      return;
    }
    nextMap[name] = meta;
  });

  return changed ? nextMap : metaMap;
};

export const buildIndexedColumnMetadata = (
  columns: ColumnDefinition[],
  indexes: IndexDefinition[] | undefined,
): DataGridIndexedColumnMetadata => {
  if (!indexes) return {};
  return {
    columnMetaMap: applyIndexColumnKeysToColumnMetaMap(
      buildColumnMetaMap(columns),
      resolveIndexColumnKeys(indexes),
    ),
    uniqueKeyGroups: resolveUniqueKeyGroupsFromIndexes(indexes),
  };
};
