import type { ForeignKeyDefinition } from '../types';
import type { ForeignKeySqlForm } from './tableDesignerForeignKeySql';

export const replaceForeignKeyDefinitionsFromForm = (
  fks: ForeignKeyDefinition[],
  previousConstraint: string | undefined,
  form: ForeignKeySqlForm,
): ForeignKeyDefinition[] => {
  const previous = String(previousConstraint || '').trim().toUpperCase();
  const kept = previous
    ? fks.filter((fk) => String(fk.constraintName || fk.name || '').trim().toUpperCase() !== previous)
    : fks;
  const constraintName = String(form.constraintName || '').trim();
  const refTableName = String(form.refTableName || '').trim();
  const localCols = form.columnNames.map((col) => String(col || '').trim()).filter(Boolean);
  const refCols = form.refColumnNames.map((col) => String(col || '').trim()).filter(Boolean);
  const nextRows = localCols.map((columnName, index) => ({
    name: constraintName,
    constraintName,
    columnName,
    refTableName,
    refColumnName: refCols[index] || refCols[refCols.length - 1] || '',
  }));
  return [...kept, ...nextRows];
};

export const removeForeignKeyDefinitionsByName = (
  fks: ForeignKeyDefinition[],
  constraintName: string,
): ForeignKeyDefinition[] => {
  const drop = String(constraintName || '').trim().toUpperCase();
  return fks.filter((fk) => String(fk.constraintName || fk.name || '').trim().toUpperCase() !== drop);
};

export const toForeignKeySqlForm = (row: {
  constraintName: string;
  columnNames: string[];
  refTableName: string;
  refColumnNames: string[];
}): ForeignKeySqlForm => ({
  constraintName: row.constraintName,
  columnNames: [...row.columnNames],
  refTableName: row.refTableName === '-' ? '' : row.refTableName,
  refColumnNames: [...row.refColumnNames],
});

export const toForeignKeySqlForms = (
  rows: Array<{
    constraintName: string;
    columnNames: string[];
    refTableName: string;
    refColumnNames: string[];
  }>,
): ForeignKeySqlForm[] => rows.map(toForeignKeySqlForm);
