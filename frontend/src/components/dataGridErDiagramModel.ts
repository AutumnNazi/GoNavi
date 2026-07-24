import type { ColumnDefinition, ForeignKeyDefinition } from '../types';
import { extractTableNameFromMetadataRow } from '../utils/tableMetadataRows';

export type ErDiagramRelationDirection = 'incoming' | 'outgoing' | 'self';

export interface ErDiagramRelation {
  sourceTableName: string;
  targetTableName: string;
  columnName: string;
  refColumnName: string;
  constraintName: string;
  direction: ErDiagramRelationDirection;
}

export interface ErDiagramTableSnapshot {
  tableName: string;
  columns: ColumnDefinition[];
  foreignKeys: ForeignKeyDefinition[];
  uniqueKeyGroups: string[][];
}

export interface ErDiagramNodeField {
  name: string;
  type: string;
  comment: string;
  nullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  isRelationField: boolean;
}

export interface ErDiagramNode {
  id: string;
  tableName: string;
  role: 'current' | 'incoming' | 'outgoing' | 'related';
  isCurrent: boolean;
  incomingCount: number;
  outgoingCount: number;
  relationCount: number;
  columns: ErDiagramNodeField[];
  previewColumnCount: number;
  hiddenColumnCount: number;
}

export interface ErDiagramEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  direction: ErDiagramRelationDirection;
  relationCount: number;
}

export interface BuildErDiagramGraphResult {
  nodes: ErDiagramNode[];
  edges: ErDiagramEdge[];
  relationCount: number;
  relatedTableCount: number;
  incomingTableCount: number;
  outgoingTableCount: number;
  isEmpty: boolean;
}

const readText = (source: unknown, keys: string[]): string => {
  const record = source as Record<string, unknown> | null | undefined;
  if (!record || typeof record !== 'object') {
    return '';
  }
  for (const key of keys) {
    const raw = record[key];
    if (raw !== undefined && raw !== null) {
      return String(raw).trim();
    }
  }
  for (const [sourceKey, raw] of Object.entries(record)) {
    if (keys.some((key) => sourceKey.toLowerCase() === key.toLowerCase())) {
      return raw === undefined || raw === null ? '' : String(raw).trim();
    }
  }
  return '';
};

const stripWrappedIdentifier = (value: string): string => {
  let next = String(value || '').trim();
  while (next.length > 1) {
    if (
      (next.startsWith('`') && next.endsWith('`')) ||
      (next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")) ||
      (next.startsWith('[') && next.endsWith(']'))
    ) {
      next = next.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return next;
};

const splitQualifiedName = (value: string): string[] => (
  String(value || '')
    .split('.')
    .map((part) => stripWrappedIdentifier(part))
    .filter(Boolean)
);

const normalizeColumnName = (value: string): string => stripWrappedIdentifier(value).toLowerCase();

export const normalizeErQualifiedName = (value: string): string => splitQualifiedName(value).join('.').toLowerCase();

export const getErTableNameCandidates = (value: string): string[] => {
  const parts = splitQualifiedName(value);
  if (parts.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (let start = 0; start < parts.length; start += 1) {
    const candidate = parts.slice(start).join('.').toLowerCase();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
};

export const tableNamesMatch = (left: string, right: string): boolean => {
  const leftCandidates = getErTableNameCandidates(left);
  const rightCandidates = new Set(getErTableNameCandidates(right));
  return leftCandidates.some((candidate) => rightCandidates.has(candidate));
};

export const resolveErActualTableName = (tableName: string, candidates: string[]): string => {
  const normalizedInput = normalizeErQualifiedName(tableName);
  if (!normalizedInput) {
    return String(tableName || '').trim();
  }

  const exactMatch = candidates.find((candidate) => normalizeErQualifiedName(candidate) === normalizedInput);
  if (exactMatch) {
    return exactMatch;
  }

  const suffixCandidates = getErTableNameCandidates(tableName);
  for (const suffix of suffixCandidates) {
    const matches = candidates.filter((candidate) => getErTableNameCandidates(candidate).includes(suffix));
    if (matches.length === 1) {
      return matches[0];
    }
  }

  return String(tableName || '').trim();
};

export const extractErTableNames = (rows: unknown): string[] => {
  if (!Array.isArray(rows)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  rows.forEach((row) => {
    const candidate = extractTableNameFromMetadataRow(row);
    const normalized = normalizeErQualifiedName(candidate);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(candidate);
  });
  return result;
};

export const normalizeForeignKeyDefinitions = (rows: unknown): ForeignKeyDefinition[] => {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => ({
      name: readText(row, ['name', 'Name']),
      columnName: readText(row, ['columnName', 'ColumnName', 'column_name', 'COLUMN_NAME']),
      refTableName: readText(row, ['refTableName', 'RefTableName', 'ref_table_name', 'REF_TABLE_NAME']),
      refColumnName: readText(row, ['refColumnName', 'RefColumnName', 'ref_column_name', 'REF_COLUMN_NAME']),
      constraintName: readText(row, ['constraintName', 'ConstraintName', 'constraint_name', 'CONSTRAINT_NAME', 'name', 'Name']),
    }))
    .filter((item) => item.columnName && item.refTableName && item.refTableName !== '-');
};

const dedupeByNormalizedValue = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeErQualifiedName(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(value);
  });
  return result;
};

const matchColumnName = (left: string, right: string): boolean => normalizeColumnName(left) === normalizeColumnName(right);

const isPrimaryColumn = (column: ColumnDefinition, snapshot: ErDiagramTableSnapshot): boolean => {
  const key = String(column?.key || '').trim().toUpperCase();
  if (key === 'PRI') {
    return true;
  }
  return snapshot.uniqueKeyGroups.some((group) => group.length === 1 && matchColumnName(group[0], column.name));
};

const getNodeId = (tableName: string): string => `er:${normalizeErQualifiedName(tableName)}`;

const buildEdgeLabel = (relations: ErDiagramRelation[]): string => {
  if (relations.length === 0) {
    return '';
  }
  const labels = relations.map((relation) => {
    const refColumnName = relation.refColumnName || '?';
    return `${relation.columnName} -> ${refColumnName}`;
  });
  if (labels.length <= 2) {
    return labels.join(', ');
  }
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
};

export const buildErDiagramGraph = (params: {
  currentTableName: string;
  currentSnapshot: ErDiagramTableSnapshot;
  relatedSnapshots: ErDiagramTableSnapshot[];
  relations: ErDiagramRelation[];
  maxColumnsPerNode?: number;
}): BuildErDiagramGraphResult => {
  const {
    currentTableName,
    currentSnapshot,
    relatedSnapshots,
    relations,
    maxColumnsPerNode = 10,
  } = params;

  const snapshotByTable = new Map<string, ErDiagramTableSnapshot>();
  const setSnapshot = (snapshot: ErDiagramTableSnapshot) => {
    const key = normalizeErQualifiedName(snapshot.tableName);
    if (key) {
      snapshotByTable.set(key, snapshot);
    }
  };
  setSnapshot(currentSnapshot);
  relatedSnapshots.forEach(setSnapshot);

  const incomingCountByTable = new Map<string, number>();
  const outgoingCountByTable = new Map<string, number>();
  const relationFieldsByTable = new Map<string, Set<string>>();

  const addRelationField = (tableName: string, columnName: string) => {
    const key = normalizeErQualifiedName(tableName);
    if (!key || !columnName) {
      return;
    }
    if (!relationFieldsByTable.has(key)) {
      relationFieldsByTable.set(key, new Set<string>());
    }
    relationFieldsByTable.get(key)?.add(normalizeColumnName(columnName));
  };

  relations.forEach((relation) => {
    const sourceKey = normalizeErQualifiedName(relation.sourceTableName);
    const targetKey = normalizeErQualifiedName(relation.targetTableName);
    if (!sourceKey || !targetKey) {
      return;
    }
    addRelationField(relation.sourceTableName, relation.columnName);
    addRelationField(relation.targetTableName, relation.refColumnName);
    outgoingCountByTable.set(sourceKey, (outgoingCountByTable.get(sourceKey) || 0) + 1);
    incomingCountByTable.set(targetKey, (incomingCountByTable.get(targetKey) || 0) + 1);
  });

  const relatedTableNames = dedupeByNormalizedValue(
    relations.flatMap((relation) => [relation.sourceTableName, relation.targetTableName]),
  ).filter((tableName) => !tableNamesMatch(tableName, currentTableName));
  const outgoingRelatedTableKeys = new Set(
    relations
      .filter((relation) => tableNamesMatch(relation.sourceTableName, currentTableName))
      .map((relation) => normalizeErQualifiedName(relation.targetTableName)),
  );
  const incomingRelatedTableKeys = new Set(
    relations
      .filter((relation) => tableNamesMatch(relation.targetTableName, currentTableName))
      .map((relation) => normalizeErQualifiedName(relation.sourceTableName)),
  );

  const nodeNames = [currentSnapshot.tableName, ...relatedTableNames];
  const sortedNodeNames = nodeNames.sort((left, right) => {
    if (tableNamesMatch(left, currentTableName)) return -1;
    if (tableNamesMatch(right, currentTableName)) return 1;
    return left.localeCompare(right);
  });

  const nodes = sortedNodeNames.map((tableName) => {
    const snapshot = snapshotByTable.get(normalizeErQualifiedName(tableName)) || {
      tableName,
      columns: [],
      foreignKeys: [],
      uniqueKeyGroups: [],
    };
    const key = normalizeErQualifiedName(tableName);
    const incomingCount = incomingCountByTable.get(key) || 0;
    const outgoingCount = outgoingCountByTable.get(key) || 0;
    const foreignColumns = new Set(
      snapshot.foreignKeys.map((foreignKey) => normalizeColumnName(foreignKey.columnName)),
    );
    const relationFields = relationFieldsByTable.get(key) || new Set<string>();
    const prioritized: ColumnDefinition[] = [];
    const remainder: ColumnDefinition[] = [];

    snapshot.columns.forEach((column) => {
      const normalizedColumn = normalizeColumnName(column.name);
      const preferred =
        isPrimaryColumn(column, snapshot) ||
        foreignColumns.has(normalizedColumn) ||
        relationFields.has(normalizedColumn);
      if (preferred) {
        prioritized.push(column);
      } else {
        remainder.push(column);
      }
    });

    const allColumns = [...prioritized, ...remainder]
      .filter((column, index, allColumns) => (
        allColumns.findIndex((candidate) => matchColumnName(candidate.name, column.name)) === index
      ))
      .map<ErDiagramNodeField>((column) => {
        const normalizedColumn = normalizeColumnName(column.name);
        return {
          name: column.name,
          type: column.type || '',
          comment: column.comment || '',
          nullable: String(column.nullable || '').toUpperCase() !== 'NO',
          isPrimary: isPrimaryColumn(column, snapshot),
          isForeign: foreignColumns.has(normalizedColumn),
          isRelationField: relationFields.has(normalizedColumn),
        };
      });
    const previewColumnCount = Math.min(allColumns.length, maxColumnsPerNode);

    let role: ErDiagramNode['role'] = 'related';
    if (tableNamesMatch(tableName, currentTableName)) {
      role = 'current';
    } else if (incomingRelatedTableKeys.has(key) && !outgoingRelatedTableKeys.has(key)) {
      role = 'incoming';
    } else if (outgoingRelatedTableKeys.has(key) && !incomingRelatedTableKeys.has(key)) {
      role = 'outgoing';
    }

    return {
      id: getNodeId(tableName),
      tableName,
      role,
      isCurrent: role === 'current',
      incomingCount,
      outgoingCount,
      relationCount: incomingCount + outgoingCount,
      columns: allColumns,
      previewColumnCount,
      hiddenColumnCount: Math.max(0, allColumns.length - previewColumnCount),
    };
  });

  const edgeBuckets = new Map<string, ErDiagramRelation[]>();
  relations.forEach((relation) => {
    const sourceId = getNodeId(relation.sourceTableName);
    const targetId = getNodeId(relation.targetTableName);
    const bucketKey = `${sourceId}|${targetId}|${relation.direction}`;
    if (!edgeBuckets.has(bucketKey)) {
      edgeBuckets.set(bucketKey, []);
    }
    edgeBuckets.get(bucketKey)?.push(relation);
  });

  const edges = Array.from(edgeBuckets.entries()).map(([bucketKey, bucketRelations]) => {
    const [source, target, direction] = bucketKey.split('|');
    return {
      id: `${bucketKey}|${bucketRelations.length}`,
      source,
      target,
      label: buildEdgeLabel(bucketRelations),
      direction: direction as ErDiagramRelationDirection,
      relationCount: bucketRelations.length,
    };
  });

  const currentKey = normalizeErQualifiedName(currentTableName);
  const incomingTableCount = dedupeByNormalizedValue(
    relations
      .filter((relation) => normalizeErQualifiedName(relation.targetTableName) === currentKey)
      .map((relation) => relation.sourceTableName),
  ).filter((tableName) => !tableNamesMatch(tableName, currentTableName)).length;
  const outgoingTableCount = dedupeByNormalizedValue(
    relations
      .filter((relation) => normalizeErQualifiedName(relation.sourceTableName) === currentKey)
      .map((relation) => relation.targetTableName),
  ).filter((tableName) => !tableNamesMatch(tableName, currentTableName)).length;

  return {
    nodes,
    edges,
    relationCount: relations.length,
    relatedTableCount: relatedTableNames.length,
    incomingTableCount,
    outgoingTableCount,
    isEmpty: relations.length === 0,
  };
};
