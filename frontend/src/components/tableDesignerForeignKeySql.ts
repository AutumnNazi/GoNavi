import { splitQualifiedNameLast } from '../utils/qualifiedName';
import {
  isMysqlFamilyDialect,
  isOracleLikeDialect,
  isPgLikeDialect,
  isSqlServerDialect,
  quoteSqlIdentifierPart,
  quoteSqlIdentifierPath,
  resolveSqlDialect,
} from '../utils/sqlDialect';

export interface ForeignKeySqlForm {
  constraintName: string;
  columnNames: string[];
  refTableName: string;
  refColumnNames: string[];
}

export interface BuildForeignKeySqlInput {
  dbType: string;
  tableRef: string;
  schema?: string;
  form: ForeignKeySqlForm;
}

const qualifyRefTableName = (dbType: string, schema: string | undefined, refTableName: string): string => {
  const dialect = resolveSqlDialect(dbType);
  const raw = String(refTableName || '').trim();
  const parsed = splitQualifiedNameLast(raw, dialect);
  if (parsed.parentPath) return raw;
  if (schema && (isPgLikeDialect(dialect) || isSqlServerDialect(dialect) || isOracleLikeDialect(dialect))) {
    return `${schema}.${parsed.objectName || raw}`;
  }
  return raw;
};

export const buildForeignKeyAddSql = (input: BuildForeignKeySqlInput): string | null => {
  const dbType = resolveSqlDialect(input.dbType);
  const constraintName = String(input.form.constraintName || '').trim();
  const localCols = input.form.columnNames.map((col) => String(col || '').trim()).filter(Boolean);
  const refCols = input.form.refColumnNames.map((col) => String(col || '').trim()).filter(Boolean);
  const refTable = qualifyRefTableName(dbType, input.schema, input.form.refTableName);
  if (!constraintName || !input.tableRef || localCols.length === 0 || refCols.length === 0 || !refTable) {
    return null;
  }
  const localColsSql = localCols.map((col) => quoteSqlIdentifierPart(dbType, col)).join(', ');
  const refColsSql = refCols.map((col) => quoteSqlIdentifierPart(dbType, col)).join(', ');
  const refTableSql = quoteSqlIdentifierPath(dbType, refTable);
  const constraintSql = quoteSqlIdentifierPart(dbType, constraintName);
  return `ALTER TABLE ${input.tableRef}\nADD CONSTRAINT ${constraintSql} FOREIGN KEY (${localColsSql}) REFERENCES ${refTableSql} (${refColsSql});`;
};

export const buildForeignKeyDropSql = (input: {
  dbType: string;
  tableRef: string;
  constraintName: string;
}): string | null => {
  const constraintName = String(input.constraintName || '').trim();
  if (!constraintName || !input.tableRef) return null;
  const constraintSql = quoteSqlIdentifierPart(input.dbType, constraintName);
  if (isMysqlFamilyDialect(input.dbType)) {
    return `ALTER TABLE ${input.tableRef}\nDROP FOREIGN KEY ${constraintSql};`;
  }
  return `ALTER TABLE ${input.tableRef}\nDROP CONSTRAINT ${constraintSql};`;
};

export const buildCreateTableForeignKeyStatements = (input: {
  dbType: string;
  tableRef: string;
  schema?: string;
  foreignKeys?: ForeignKeySqlForm[];
}): string => (
  (Array.isArray(input.foreignKeys) ? input.foreignKeys : [])
    .map((form) => buildForeignKeyAddSql({
      dbType: input.dbType,
      tableRef: input.tableRef,
      schema: input.schema,
      form,
    }))
    .filter((sql): sql is string => Boolean(sql))
    .join('\n')
);
