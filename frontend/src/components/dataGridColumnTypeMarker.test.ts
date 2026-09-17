import { describe, expect, it } from 'vitest';

import type { ColumnMeta } from './dataGridColumnMeta';
import {
  applyIndexColumnKeysToColumnMetaMap,
  resolveDataGridColumnTypeRole,
  resolveIndexColumnKeys,
} from './dataGridColumnTypeMarker';

const meta = (key: string): ColumnMeta => ({
  type: 'text',
  comment: '',
  nullable: 'YES',
  default: '',
  hasDefault: false,
  extra: '',
  key,
});

describe('dataGridColumnTypeMarker', () => {
  it('ranks primary, unique, foreign-key, and index roles in that order', () => {
    expect(resolveDataGridColumnTypeRole({ key: 'PRI', hasForeignKey: true })).toBe('pk');
    expect(resolveDataGridColumnTypeRole({ key: 'UNI', hasForeignKey: true })).toBe('unique');
    expect(resolveDataGridColumnTypeRole({ key: '', hasForeignKey: true })).toBe('fk');
    expect(resolveDataGridColumnTypeRole({ key: 'MUL' })).toBe('index');
    expect(resolveDataGridColumnTypeRole({ key: '' })).toBe('none');
  });

  it('maps PostgreSQL-style indexes onto PRI/UNI/MUL keys', () => {
    expect(resolveIndexColumnKeys([
      { name: 'lab_customers_pkey', columnName: 'id', nonUnique: 0, seqInIndex: 1, indexType: 'BTREE' },
      { name: 'lab_customers_email_key', columnName: 'email', nonUnique: 0, seqInIndex: 1, indexType: 'BTREE' },
      { name: 'idx_lab_customers_city', columnName: 'city', nonUnique: 1, seqInIndex: 1, indexType: 'BTREE' },
      { name: 'idx_lab_customers_city', columnName: 'id', nonUnique: 1, seqInIndex: 2, indexType: 'BTREE' },
    ])).toEqual({
      id: 'PRI',
      email: 'UNI',
      city: 'MUL',
    });
  });

  it('does not weaken an existing primary-key column when secondary indexes also cover it', () => {
    const current = {
      id: meta('PRI'),
      city: meta(''),
    };
    const merged = applyIndexColumnKeysToColumnMetaMap(current, {
      id: 'MUL',
      city: 'MUL',
    });

    expect(merged.id.key).toBe('PRI');
    expect(merged.city.key).toBe('MUL');
    expect(merged).not.toBe(current);
  });

  it('returns the same map when index keys do not change any column', () => {
    const current = { id: meta('PRI') };
    expect(applyIndexColumnKeysToColumnMetaMap(current, { id: 'UNI' })).toBe(current);
  });
});
