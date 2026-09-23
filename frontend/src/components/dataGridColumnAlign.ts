import { isTemporalColumnType, type TemporalConnectionLike } from './dataGridTemporal';

export type GridColumnAlign = 'left' | 'right';

const NUMERIC_GRID_COLUMN_BASE_TYPES = new Set([
  'bigdecimal',
  'bigint',
  'bigserial',
  'binary_double',
  'binary_float',
  'dec',
  'decimal',
  'double',
  'fixed',
  'float',
  'float4',
  'float8',
  'float32',
  'float64',
  'hugeint',
  'int',
  'int2',
  'int4',
  'int8',
  'int16',
  'int32',
  'int64',
  'int128',
  'int256',
  'integer',
  'mediumint',
  'money',
  'number',
  'numeric',
  'real',
  'serial',
  'serial2',
  'serial4',
  'serial8',
  'smallint',
  'smallmoney',
  'smallserial',
  'tinyint',
  'ubigint',
  'uinteger',
  'usmallint',
  'utinyint',
]);

// 与 DataGridCore 的筛选列类型归一化保持一致：去掉 Nullable(...) / LowCardinality(...) 包装。
export const normalizeGridColumnTypeForAlign = (columnType: unknown): string => {
  let normalized = String(columnType ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < 4; i += 1) {
    const wrapped = normalized.match(/^(?:nullable|lowcardinality)\((.+)\)$/);
    if (!wrapped) break;
    normalized = wrapped[1].trim().replace(/\s+/g, ' ');
  }
  return normalized;
};

export const isNumericGridColumnType = (columnType: unknown): boolean => {
  const normalized = normalizeGridColumnTypeForAlign(columnType);
  if (!normalized) return false;
  const baseType = normalized.split(/[ (]/)[0];
  if (NUMERIC_GRID_COLUMN_BASE_TYPES.has(baseType)) return true;
  return /^u?int\d*$/.test(baseType);
};

// 未知类型一律回退左对齐；布尔（bool/boolean/bit）与文本类型不在数值集合内，同样保持左对齐。
export const resolveGridColumnAlign = (
  columnType: unknown,
  dbType?: string,
  connectionConfig?: TemporalConnectionLike,
): GridColumnAlign => {
  const normalized = normalizeGridColumnTypeForAlign(columnType);
  if (!normalized) return 'left';
  if (isNumericGridColumnType(normalized)) return 'right';
  if (isTemporalColumnType(normalized, dbType, connectionConfig)) return 'right';
  return 'left';
};
