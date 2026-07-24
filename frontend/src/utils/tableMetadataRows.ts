const TABLE_NAME_KEY_PRIORITY = ['table', 'table_name', 'tablename', 'name'] as const;

const toNonEmptyText = (value: unknown): string => String(value ?? '').trim();

export const extractTableNameFromMetadataRow = (row: unknown): string => {
  if (typeof row === 'string') {
    return row.trim();
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return '';
  }

  const entries = Object.entries(row as Record<string, unknown>);
  const valuesByKey = new Map(entries.map(([key, value]) => [key.trim().toLowerCase(), value]));

  for (const key of TABLE_NAME_KEY_PRIORITY) {
    const name = toNonEmptyText(valuesByKey.get(key));
    if (name) {
      return name;
    }
  }

  const mysqlTableEntry = entries.find(([key]) => key.trim().toLowerCase().startsWith('tables_in_'));
  const mysqlTableName = toNonEmptyText(mysqlTableEntry?.[1]);
  if (mysqlTableName) {
    return mysqlTableName;
  }

  return entries.length === 1 ? toNonEmptyText(entries[0][1]) : '';
};

export const normalizeTableNamesFromMetadataRows = (rows: unknown): string[] => {
  if (!Array.isArray(rows)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  rows.forEach((row) => {
    const name = extractTableNameFromMetadataRow(row);
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    names.push(name);
  });
  return names;
};
