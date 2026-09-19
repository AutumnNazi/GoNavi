export type IndexKind = 'NORMAL' | 'UNIQUE' | 'PRIMARY' | 'FULLTEXT' | 'SPATIAL';

export interface IndexDisplaySnapshot {
  key: string;
  name: string;
  indexType: string;
  nonUnique: number;
  columnNames: string[];
}

export interface IndexFormSnapshot {
  name: string;
  columnNames: string[];
  kind: IndexKind;
  indexType: string;
}

export interface SchemaExecutionSnapshot {
  failedStatementIndex?: number;
  outcomeUnknown?: boolean;
  cancellationState?: string;
}

export interface IndexMetadataResponse {
  success: boolean;
  data?: unknown;
  message?: unknown;
}

export interface IndexMetadataResolution<T> {
  indexes: T[];
  errorDetail: string | null;
}

export const resolveIndexMetadataResponse = <T = unknown>(
  response: IndexMetadataResponse,
): IndexMetadataResolution<T> => {
  if (!response.success) {
    return {
      indexes: [],
      errorDetail: String(response.message || '').trim(),
    };
  }

  return {
    indexes: Array.isArray(response.data) ? response.data as T[] : [],
    errorDetail: null,
  };
};

export const normalizeIndexFormFromRow = (
  row: IndexDisplaySnapshot,
  supportedKinds: IndexKind[],
): IndexFormSnapshot => {
  const selectedName = String(row.name || '').trim();
  const selectedNameUpper = selectedName.toUpperCase();
  const selectedTypeUpper = String(row.indexType || '').trim().toUpperCase();
  let kind: IndexKind = 'NORMAL';
  if (selectedNameUpper === 'PRIMARY') {
    kind = 'PRIMARY';
  } else if (selectedTypeUpper === 'FULLTEXT') {
    kind = 'FULLTEXT';
  } else if (selectedTypeUpper === 'SPATIAL') {
    kind = 'SPATIAL';
  } else if (row.nonUnique === 0) {
    kind = 'UNIQUE';
  }
  if (!supportedKinds.includes(kind)) {
    kind = row.nonUnique === 0 ? 'UNIQUE' : 'NORMAL';
  }
  return {
    name: kind === 'PRIMARY' ? 'PRIMARY' : selectedName,
    columnNames: [...row.columnNames],
    kind,
    indexType: kind === 'NORMAL' || kind === 'UNIQUE'
      ? (selectedTypeUpper || 'DEFAULT')
      : 'DEFAULT',
  };
};

export const hasIndexFormChanged = (
  previousForm: IndexFormSnapshot,
  nextForm: IndexFormSnapshot,
): boolean => {
  if (previousForm.name !== nextForm.name) return true;
  if (previousForm.kind !== nextForm.kind) return true;
  if (previousForm.indexType !== nextForm.indexType) return true;
  if (previousForm.columnNames.length !== nextForm.columnNames.length) return true;
  return previousForm.columnNames.some((col, idx) => col !== nextForm.columnNames[idx]);
};

export const toggleIndexSelection = (
  selectedKeys: string[],
  key: string,
  checked?: boolean,
): string[] => {
  const exists = selectedKeys.includes(key);
  const nextChecked = checked ?? !exists;
  if (nextChecked) {
    return exists ? selectedKeys : [...selectedKeys, key];
  }
  return selectedKeys.filter((item) => item !== key);
};

export const shouldRestoreOriginalIndex = (result: SchemaExecutionSnapshot): boolean => (
  !result.outcomeUnknown
  && String(result.cancellationState || '').trim().toLowerCase() !== 'unsupported'
  && (result.failedStatementIndex ?? -1) > 0
);

const storedIndexType = (form: IndexFormSnapshot): string => {
  if (form.kind === 'FULLTEXT') return 'FULLTEXT';
  if (form.kind === 'SPATIAL') return 'SPATIAL';
  if (form.kind === 'PRIMARY') return 'BTREE';
  const normalized = String(form.indexType || '').trim().toUpperCase();
  return !normalized || normalized === 'DEFAULT' ? '' : normalized;
};

export const applyPrimaryIndexToColumnKeys = <T extends { name: string; key?: string }>(
  columns: T[],
  primaryColumnNames: string[],
): T[] => {
  const selected = new Set(
    primaryColumnNames.map((name) => String(name || '').trim()).filter(Boolean),
  );
  return columns.map((column) => {
    const isPrimary = selected.has(String(column.name || '').trim());
    const currentKey = String(column.key || '');
    if (isPrimary) {
      return currentKey === 'PRI' ? column : { ...column, key: 'PRI' };
    }
    if (currentKey === 'PRI') {
      return { ...column, key: '' };
    }
    return column;
  });
};

export const replaceIndexDefinitionsFromForm = (
  indexes: Array<{
    name: string;
    columnName: string;
    nonUnique: number;
    seqInIndex: number;
    indexType: string;
  }>,
  previousName: string | undefined,
  form: IndexFormSnapshot,
): Array<{
  name: string;
  columnName: string;
  nonUnique: number;
  seqInIndex: number;
  indexType: string;
}> => {
  const previous = String(previousName || '').trim().toUpperCase();
  const kept = previous
    ? indexes.filter((idx) => String(idx.name || '').trim().toUpperCase() !== previous)
    : indexes;
  const nextName = form.kind === 'PRIMARY' ? 'PRIMARY' : String(form.name || '').trim();
  const indexType = storedIndexType(form);
  const nonUnique = form.kind === 'UNIQUE' || form.kind === 'PRIMARY' ? 0 : 1;
  const nextRows = form.columnNames
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .map((columnName, index) => ({
      name: nextName,
      columnName,
      nonUnique,
      seqInIndex: index + 1,
      indexType,
    }));
  return [...kept, ...nextRows];
};

export const removeIndexDefinitionsByNames = <T extends { name: string }>(
  indexes: T[],
  names: string[],
): T[] => {
  const drop = new Set(names.map((name) => String(name || '').trim().toUpperCase()).filter(Boolean));
  return indexes.filter((idx) => !drop.has(String(idx.name || '').trim().toUpperCase()));
};
