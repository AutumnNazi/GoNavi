import { describe, expect, it } from 'vitest';

import {
  extractTableNameFromMetadataRow,
  normalizeTableNamesFromMetadataRows,
} from './tableMetadataRows';

describe('table metadata rows', () => {
  it('prefers explicit table fields over row and storage statistics', () => {
    expect(extractTableNameFromMetadataRow({ Rows: '128', Table: 'users', Data_length: '4096' })).toBe('users');
    expect(extractTableNameFromMetadataRow({ Name: 'metadata-label', TABLE: 'customers' })).toBe('customers');
    expect(extractTableNameFromMetadataRow({ Index_length: '2048', table_name: 'orders' })).toBe('orders');
  });

  it('supports legacy one-column and MySQL table-list rows without guessing multi-field metadata', () => {
    expect(extractTableNameFromMetadataRow({ Tables_in_app: 'events' })).toBe('events');
    expect(extractTableNameFromMetadataRow({ arbitrary_column: 'legacy_table' })).toBe('legacy_table');
    expect(extractTableNameFromMetadataRow({ Rows: '12', Data_length: '2048' })).toBe('');
  });

  it('normalizes string and object rows while removing empty and duplicate names', () => {
    expect(normalizeTableNamesFromMetadataRows([
      ' users ',
      { Table: 'orders', Rows: '42' },
      { table_name: 'users' },
      { Table: '' },
      null,
    ])).toEqual(['users', 'orders']);
  });
});
