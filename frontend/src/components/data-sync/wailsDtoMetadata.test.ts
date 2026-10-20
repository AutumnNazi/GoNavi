import { describe, expect, it } from 'vitest';

import { decodeFieldMetadata } from './wailsDtoMetadata';

const field = (name: string, key: string) => ({ name, type: 'bigint', nullable: 'NO', key });

describe('decodeFieldMetadata key detection', () => {
  it('marks only physical primary-key columns as keys', () => {
    const decoded = decodeFieldMetadata([
      field('id', 'PRI'),
      field('sqlite_id', 'pk'),
      field('legacy_id', 'PRIMARY'),
      field('email', 'UNI'),
      field('code', 'UNIQUE'),
      field('customer_id', 'MUL'),
      field('remark', ''),
    ]);

    expect(decoded.filter((column) => column.key).map((column) => column.name)).toEqual([
      'id',
      'sqlite_id',
      'legacy_id',
    ]);
  });
});
