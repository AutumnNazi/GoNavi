import type { ColumnDefinition } from '../types';
import {
  getColumnDefinitionComment,
  getColumnDefinitionDefault,
  getColumnDefinitionExtra,
  getColumnDefinitionKey,
  getColumnDefinitionName,
  getColumnDefinitionNullable,
  getColumnDefinitionType,
  hasColumnDefinitionDefault,
} from '../utils/columnDefinition';

export type ColumnMeta = {
  type: string;
  comment: string;
  nullable: string;
  default: string;
  hasDefault: boolean;
  extra: string;
  key: string;
};

export const buildColumnMetaMap = (columns: ColumnDefinition[]): Record<string, ColumnMeta> => {
  const nextMap: Record<string, ColumnMeta> = {};
  (columns || []).forEach((column: ColumnDefinition) => {
    const name = getColumnDefinitionName(column);
    if (!name) return;
    nextMap[name] = {
      type: getColumnDefinitionType(column),
      comment: getColumnDefinitionComment(column),
      nullable: getColumnDefinitionNullable(column),
      default: getColumnDefinitionDefault(column),
      hasDefault: hasColumnDefinitionDefault(column),
      extra: getColumnDefinitionExtra(column),
      key: getColumnDefinitionKey(column),
    };
  });
  return nextMap;
};

export const hasUsableColumnMeta = (metaMap: Record<string, ColumnMeta>): boolean => (
  Object.values(metaMap || {}).some((meta) => {
    const type = String(meta?.type || '').trim();
    const comment = String(meta?.comment || '').trim();
    return type.length > 0 || comment.length > 0;
  })
);

export const shouldOmitBlankDataGridInsertValue = (
  value: unknown,
  mode: 'insert' | 'update',
  meta?: Partial<ColumnMeta>,
): boolean => {
  if (mode !== 'insert' || typeof value !== 'string' || value.trim() !== '') {
    return false;
  }
  const extra = String(meta?.extra || '').trim().toLowerCase();
  return meta?.hasDefault === true
    || String(meta?.default || '').trim() !== ''
    || extra.includes('auto_increment')
    || extra.includes('identity');
};
