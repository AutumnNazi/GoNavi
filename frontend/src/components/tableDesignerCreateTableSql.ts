import type { TriggerDefinition } from '../types';
import { splitQualifiedNameLast } from '../utils/qualifiedName';
import { quoteSqlIdentifierPath } from '../utils/sqlDialect';
import { applyCreateTableCommentSql } from './tableDesignerTableCommentSql';
import { buildCreateTableIndexStatements } from './tableDesignerIndexSql';
import { applyPrimaryIndexToColumnKeys, type IndexFormSnapshot } from './tableDesignerIndexUtils';
import { buildCreateTableForeignKeyStatements, type ForeignKeySqlForm } from './tableDesignerForeignKeySql';
import { collectCreateTableTriggerSql } from './tableDesignerTriggerDraft';
import {
  buildCreateTablePreviewSql,
  type BuildCreateTablePreviewInput,
  type EditableColumnSnapshot,
} from './tableDesignerSchemaSql';

export interface BuildNewTablePreviewInput extends BuildCreateTablePreviewInput {
  comment?: string;
  indexes?: IndexFormSnapshot[];
  foreignKeys?: ForeignKeySqlForm[];
  triggers?: TriggerDefinition[];
}

const mergePrimaryIndexIntoCreateColumns = (
  columns: EditableColumnSnapshot[],
  indexes: IndexFormSnapshot[] | undefined,
): EditableColumnSnapshot[] => {
  const primary = (Array.isArray(indexes) ? indexes : []).find((index) => index.kind === 'PRIMARY');
  if (!primary) return columns;
  return applyPrimaryIndexToColumnKeys(columns, primary.columnNames);
};

export const buildNewTablePreviewSql = (input: BuildNewTablePreviewInput): string => {
  const columns = mergePrimaryIndexIntoCreateColumns(input.columns, input.indexes);
  const baseSql = buildCreateTablePreviewSql({
    ...input,
    columns,
  });
  const withComment = applyCreateTableCommentSql(
    baseSql,
    input.dbType,
    input.tableName,
    input.comment || '',
  );
  const tableRef = quoteSqlIdentifierPath(input.dbType, input.tableName);
  const indexSql = buildCreateTableIndexStatements({
    dbType: input.dbType,
    tableRef,
    indexes: input.indexes,
    translate: input.translate,
  });
  const foreignKeySql = buildCreateTableForeignKeyStatements({
    dbType: input.dbType,
    tableRef,
    schema: splitQualifiedNameLast(input.tableName, input.dbType).parentPath,
    foreignKeys: input.foreignKeys,
  });
  const triggerSql = collectCreateTableTriggerSql(input.triggers);
  return [withComment, indexSql, foreignKeySql, triggerSql].filter((sql) => String(sql || '').trim()).join('\n');
};
