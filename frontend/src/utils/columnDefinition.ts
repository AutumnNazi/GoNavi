import type { ColumnDefinition } from '../types';

const readStringProperty = (value: unknown, keys: string[]): string => {
  const source = value as Record<string, unknown> | null | undefined;
  if (!source || typeof source !== 'object') return '';

  for (const key of keys) {
    const raw = source[key];
    if (raw !== undefined && raw !== null) {
      return String(raw).trim();
    }
  }

  for (const [sourceKey, raw] of Object.entries(source)) {
    if (keys.some((key) => sourceKey.toLowerCase() === key.toLowerCase())) {
      return raw === undefined || raw === null ? '' : String(raw).trim();
    }
  }

  return '';
};

const readProperty = (value: unknown, keys: string[]): unknown => {
  const source = value as Record<string, unknown> | null | undefined;
  if (!source || typeof source !== 'object') return undefined;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  for (const [sourceKey, raw] of Object.entries(source)) {
    if (keys.some((key) => sourceKey.toLowerCase() === key.toLowerCase())) {
      return raw;
    }
  }

  return undefined;
};

const readBooleanProperty = (value: unknown, keys: string[]): boolean => {
  const raw = readProperty(value, keys);
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const text = String(raw).trim().toLowerCase();
  return text === '1' || text === 't' || text === 'true' || text === 'y' || text === 'yes' || text === 'pri' || text === 'primary';
};

const readNumberProperty = (value: unknown, keys: string[]): number => {
  const raw = readProperty(value, keys);
  if (raw === undefined || raw === null || raw === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

const normalizeNullable = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const upper = normalized.toUpperCase();
  if (upper === 'N' || upper === 'NO' || upper === 'FALSE' || upper === '0' || upper === 'NOT NULL') {
    return 'NO';
  }
  if (upper === 'Y' || upper === 'YES' || upper === 'TRUE' || upper === '1' || upper === 'NULL' || upper === 'NULLABLE') {
    return 'YES';
  }
  return normalized;
};

export const getColumnDefinitionName = (column: unknown): string => (
  readStringProperty(column, ['name', 'Name', 'COLUMN_NAME', 'column_name', 'field', 'Field'])
);

export const getColumnDefinitionType = (column: unknown): string => {
  const fullType = readStringProperty(column, [
    'COLUMN_TYPE',
    'column_type',
    'FULL_TYPE',
    'full_type',
    'FULL_DATA_TYPE',
    'full_data_type',
    'TYPE_NAME',
    'type_name',
    'Type',
    'type',
  ]);
  if (fullType) return fullType;

  const dataType = readStringProperty(column, ['DATA_TYPE', 'data_type']);
  if (!dataType || /\(.+\)/.test(dataType)) return dataType;

  const upperType = dataType.toUpperCase();
  const charLength = readNumberProperty(column, [
    'CHARACTER_MAXIMUM_LENGTH',
    'character_maximum_length',
    'CHARACTER_MAX_LENGTH',
    'character_max_length',
    'CHAR_LENGTH',
    'char_length',
    'DATA_LENGTH',
    'data_length',
    'LENGTH',
    'length',
  ]);
  if (charLength > 0 && /(CHAR|VARCHAR|BINARY|VARBINARY|NCHAR|NVARCHAR)/.test(upperType)) {
    return `${dataType}(${charLength})`;
  }

  const precision = readNumberProperty(column, [
    'NUMERIC_PRECISION',
    'numeric_precision',
    'DATA_PRECISION',
    'data_precision',
    'PRECISION',
    'precision',
  ]);
  if (precision > 0 && /(DECIMAL|NUMERIC|NUMBER)/.test(upperType)) {
    const scale = readNumberProperty(column, [
      'NUMERIC_SCALE',
      'numeric_scale',
      'DATA_SCALE',
      'data_scale',
      'SCALE',
      'scale',
    ]);
    return scale > 0 ? `${dataType}(${precision},${scale})` : `${dataType}(${precision})`;
  }

  return dataType;
};

export const getColumnDefinitionKey = (column: unknown): string => {
  const key = readStringProperty(column, ['key', 'Key', 'COLUMN_KEY', 'column_key']);
  if (key) {
    const normalized = key.trim();
    const lowered = normalized.toLowerCase();
    if (lowered === 'pri' || lowered === 'primary' || lowered === 'primary key') return 'PRI';
    if (lowered === 'uni' || lowered === 'unique') return 'UNI';
    if (lowered === 'mul' || lowered === 'multiple') return 'MUL';
    return normalized;
  }
  if (readBooleanProperty(column, ['primaryKey', 'primary_key', 'isPrimary', 'is_primary', 'IS_PRIMARY', 'pk', 'PK'])) {
    return 'PRI';
  }
  if (readBooleanProperty(column, ['unique', 'isUnique', 'is_unique', 'UNIQUE', 'IS_UNIQUE'])) {
    return 'UNI';
  }
  return '';
};

export const getColumnDefinitionExtra = (column: unknown): string => (
  readStringProperty(column, ['extra', 'Extra'])
);

export const getColumnDefinitionNullable = (column: unknown): string => (
  normalizeNullable(readStringProperty(column, ['nullable', 'Nullable', 'NULLABLE', 'is_nullable', 'IS_NULLABLE', 'Null', 'null']))
);

export const getColumnDefinitionDefault = (column: unknown): string => (
  readStringProperty(column, ['default', 'Default', 'COLUMN_DEFAULT', 'column_default', 'DATA_DEFAULT', 'data_default'])
);

export const hasColumnDefinitionDefault = (column: unknown): boolean => {
  const raw = readProperty(column, ['default', 'Default', 'COLUMN_DEFAULT', 'column_default', 'DATA_DEFAULT', 'data_default']);
  return raw !== undefined && raw !== null;
};

export const getColumnDefinitionComment = (column: unknown): string => (
  readStringProperty(column, ['comment', 'Comment', 'COMMENTS', 'comments', 'COLUMN_COMMENT', 'column_comment'])
);

export const normalizeColumnDefinition = (column: unknown): ColumnDefinition => {
  const source = (column && typeof column === 'object' ? column : {}) as Partial<ColumnDefinition>;
  const hasDefault = hasColumnDefinitionDefault(column);
  return {
    ...source,
    name: getColumnDefinitionName(column),
    type: getColumnDefinitionType(column),
    nullable: getColumnDefinitionNullable(column),
    key: getColumnDefinitionKey(column),
    default: hasDefault ? getColumnDefinitionDefault(column) : undefined,
    extra: getColumnDefinitionExtra(column),
    comment: getColumnDefinitionComment(column),
  };
};

export const normalizeColumnDefinitions = (columns: unknown): ColumnDefinition[] => (
  Array.isArray(columns) ? columns.map(normalizeColumnDefinition) : []
);
