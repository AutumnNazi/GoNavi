import type { IndexDefinition } from '../types';
import { resolveUniqueKeyGroupsFromIndexes } from '../components/dataGridCopyInsert';
import { isOracleLikeDialect } from './sqlDialect';
import { t as translateCatalog, type I18nParams } from '../i18n';

export const ORACLE_ROWID_LOCATOR_COLUMN = '__gonavi_oracle_rowid__';
export const DUCKDB_ROWID_LOCATOR_COLUMN = '__gonavi_duckdb_rowid__';

export type RowLocatorStrategy = 'primary-key' | 'unique-key' | 'oracle-rowid' | 'duckdb-rowid' | 'all-columns' | 'none';

export type EditRowLocator = {
  strategy: RowLocatorStrategy;
  columns: string[];
  valueColumns: string[];
  hiddenColumns?: string[];
  writableColumns?: Record<string, string>;
  readOnly: boolean;
  reason?: string;
};

export type ResolveEditRowLocatorParams = {
  dbType: string;
  resultColumns: string[];
  primaryKeys?: string[];
  indexes?: IndexDefinition[];
  allowOracleRowID?: boolean;
  allowDuckDBRowID?: boolean;
  translate?: RowLocatorTranslator;
};

export type ResolveRowLocatorValuesResult =
  | { ok: true; values: Record<string, any> }
  | { ok: false; error: string };

export type RowLocatorMessages = {
  noSafeLocator?: () => string;
  emptyLocatorValue?: (column: string) => string;
};

type RowLocatorTranslator = (key: string, params?: I18nParams) => string;

const normalizeColumnName = (value: string): string => String(value || '').trim();

const hasColumn = (columns: string[], target: string): boolean => {
  const normalizedTarget = normalizeColumnName(target).toLowerCase();
  return columns.some((column) => normalizeColumnName(column).toLowerCase() === normalizedTarget);
};

const findColumn = (columns: string[], target: string): string => {
  const normalizedTarget = normalizeColumnName(target).toLowerCase();
  return columns.find((column) => normalizeColumnName(column).toLowerCase() === normalizedTarget) || target;
};

const GONAVI_INTERNAL_COLUMN_PREFIX = '__gonavi';

// Values longer than this are excluded from all-columns locators because
// LOB-typed columns cannot be compared with "=" on several dialects (Oracle).
const ALL_COLUMNS_LOCATOR_MAX_VALUE_LENGTH = 4000;

const ALL_COLUMNS_LOCATOR_HINT_KEY = 'data_viewer.edit_hint.all_columns_locator';

const isInternalLocatorColumn = (column: string): boolean => (
  normalizeColumnName(column).toLowerCase().startsWith(GONAVI_INTERNAL_COLUMN_PREFIX)
);

const isScalarLocatorValue = (value: any): boolean => (
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
);

export const buildAllColumnsLocator = (
  resultColumns: string[],
  options?: {
    hiddenColumns?: string[];
    writableColumns?: Record<string, string>;
    translate?: RowLocatorTranslator;
  },
): EditRowLocator => {
  const hidden = new Set((options?.hiddenColumns || []).map((column) => normalizeColumnName(column).toLowerCase()));
  const columns = (resultColumns || [])
    .map(normalizeColumnName)
    .filter(Boolean)
    .filter((column) => !isInternalLocatorColumn(column))
    .filter((column) => !hidden.has(column.toLowerCase()));
  return {
    strategy: 'all-columns',
    columns,
    valueColumns: [...columns],
    hiddenColumns: options?.hiddenColumns,
    writableColumns: options?.writableColumns,
    readOnly: false,
    reason: translateReason(options?.translate, ALL_COLUMNS_LOCATOR_HINT_KEY),
  };
};

const translateReason = (
  translate: RowLocatorTranslator | undefined,
  key: string,
  params?: I18nParams,
): string => {
  const fallback = translateCatalog(key, params, 'en-US');
  const translated = translate ? translate(key, params) : fallback;
  return translated && translated !== key ? translated : fallback;
};

export const resolveEditRowLocator = ({
  dbType,
  resultColumns,
  primaryKeys = [],
  indexes,
  allowOracleRowID = false,
  allowDuckDBRowID = false,
  translate,
}: ResolveEditRowLocatorParams): EditRowLocator => {
  const columns = (resultColumns || []).map(normalizeColumnName).filter(Boolean);
  const primaryKeyColumns = (primaryKeys || []).map(normalizeColumnName).filter(Boolean);

  if (primaryKeyColumns.length > 0) {
    const missing = primaryKeyColumns.filter((column) => !hasColumn(columns, column));
    if (missing.length === 0) {
      return {
        strategy: 'primary-key',
        columns: primaryKeyColumns,
        valueColumns: primaryKeyColumns.map((column) => findColumn(columns, column)),
        readOnly: false,
      };
    }
    return buildAllColumnsLocator(columns, { translate });
  }

  const uniqueKeyGroups = resolveUniqueKeyGroupsFromIndexes(indexes);
  const uniqueKeyGroup = uniqueKeyGroups.find((group) => group.length > 0 && group.every((column) => hasColumn(columns, column)));
  if (uniqueKeyGroup) {
    return {
      strategy: 'unique-key',
      columns: uniqueKeyGroup,
      valueColumns: uniqueKeyGroup.map((column) => findColumn(columns, column)),
      readOnly: false,
    };
  }

  if (allowOracleRowID && isOracleLikeDialect(dbType) && hasColumn(columns, ORACLE_ROWID_LOCATOR_COLUMN)) {
    const rowIDColumn = findColumn(columns, ORACLE_ROWID_LOCATOR_COLUMN);
    return {
      strategy: 'oracle-rowid',
      columns: ['ROWID'],
      valueColumns: [rowIDColumn],
      hiddenColumns: [rowIDColumn],
      readOnly: false,
    };
  }

  if (allowDuckDBRowID && String(dbType || '').trim().toLowerCase() === 'duckdb' && hasColumn(columns, DUCKDB_ROWID_LOCATOR_COLUMN)) {
    const rowIDColumn = findColumn(columns, DUCKDB_ROWID_LOCATOR_COLUMN);
    return {
      strategy: 'duckdb-rowid',
      columns: ['rowid'],
      valueColumns: [rowIDColumn],
      hiddenColumns: [rowIDColumn],
      readOnly: false,
    };
  }

  return buildAllColumnsLocator(columns, { translate });
};

const resolveAllColumnsLocatorValues = (
  locator: EditRowLocator,
  row: Record<string, any>,
  messages?: RowLocatorMessages,
): ResolveRowLocatorValuesResult => {
  const hidden = new Set((locator.hiddenColumns || []).map((column) => normalizeColumnName(column).toLowerCase()));
  const rowKeys = Object.keys(row || {});
  const rowKeyByLower = new Map<string, string>();
  rowKeys.forEach((key) => rowKeyByLower.set(normalizeColumnName(key).toLowerCase(), key));

  const candidateColumns = (locator.columns.length > 0 ? locator.columns : rowKeys)
    .map(normalizeColumnName)
    .filter(Boolean)
    .filter((column) => !isInternalLocatorColumn(column))
    .filter((column) => !hidden.has(column.toLowerCase()));

  const values: Record<string, any> = {};
  candidateColumns.forEach((column) => {
    const rowKey = rowKeyByLower.get(column.toLowerCase());
    if (rowKey === undefined) return;
    const value = row?.[rowKey];
    if (value === null || value === undefined || value === '') return;
    if (!isScalarLocatorValue(value)) return;
    if (typeof value === 'string' && value.length > ALL_COLUMNS_LOCATOR_MAX_VALUE_LENGTH) return;
    values[column] = value;
  });

  if (Object.keys(values).length === 0) {
    return { ok: false, error: messages?.noSafeLocator?.() || 'No usable locator values were found on this row, so changes cannot be submitted safely.' };
  }
  return { ok: true, values };
};

export const resolveRowLocatorValues = (
  locator: EditRowLocator | undefined,
  row: Record<string, any>,
  messages?: RowLocatorMessages,
): ResolveRowLocatorValuesResult => {
  if (!locator || locator.readOnly || locator.strategy === 'none') {
    return { ok: false, error: messages?.noSafeLocator?.() || 'No safe row locator is available for this result set.' };
  }

  if (locator.strategy === 'all-columns') {
    return resolveAllColumnsLocatorValues(locator, row, messages);
  }

  const values: Record<string, any> = {};
  for (let index = 0; index < locator.columns.length; index++) {
    const column = locator.columns[index];
    const valueColumn = locator.valueColumns[index] || column;
    const value = row?.[valueColumn];
    if (value === null || value === undefined || value === '') {
      return { ok: false, error: messages?.emptyLocatorValue?.(column) || `Locator column ${column} is empty, so changes cannot be submitted safely.` };
    }
    values[column] = value;
  }

  return { ok: true, values };
};

export const filterHiddenLocatorColumns = (columns: string[], locator?: EditRowLocator): string[] => {
  const hidden = new Set((locator?.hiddenColumns || []).map((column) => normalizeColumnName(column).toLowerCase()));
  if (hidden.size === 0) return columns;
  return (columns || []).filter((column) => !hidden.has(normalizeColumnName(column).toLowerCase()));
};

export const isHiddenLocatorColumn = (column: string, locator?: EditRowLocator): boolean => {
  const normalized = normalizeColumnName(column).toLowerCase();
  return (locator?.hiddenColumns || []).some((hidden) => normalizeColumnName(hidden).toLowerCase() === normalized);
};

export const resolveWritableColumnName = (column: string, locator?: EditRowLocator): string | undefined => {
  const normalized = normalizeColumnName(column);
  if (!normalized || isHiddenLocatorColumn(normalized, locator)) return undefined;
  const writableColumns = locator?.writableColumns;
  if (!writableColumns) return normalized;

  const normalizedTarget = normalized.toLowerCase();
  const matchedEntry = Object.entries(writableColumns).find(([resultColumn]) => (
    normalizeColumnName(resultColumn).toLowerCase() === normalizedTarget
  ));
  const tableColumnName = normalizeColumnName(matchedEntry?.[1] || '');
  return tableColumnName || undefined;
};

export const isWritableResultColumn = (column: string, locator?: EditRowLocator): boolean => (
  resolveWritableColumnName(column, locator) !== undefined
);
