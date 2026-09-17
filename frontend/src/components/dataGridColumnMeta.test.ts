import { describe, expect, it } from 'vitest';

import { buildColumnMetaMap, hasUsableColumnMeta, shouldOmitBlankDataGridInsertValue } from './dataGridColumnMeta';

describe('dataGridColumnMeta', () => {
  it('keeps column key metadata when building the header meta map', () => {
    const metaMap = buildColumnMetaMap([
      {
        name: 'id',
        type: 'bigint',
        nullable: 'NO',
        key: 'PRI',
        extra: 'auto_increment',
        comment: '主键',
      },
      {
        name: 'email',
        type: 'varchar(64)',
        nullable: 'NO',
        key: 'UNI',
        extra: '',
        comment: '',
      },
    ]);

    expect(metaMap.id).toMatchObject({ type: 'bigint', key: 'PRI', comment: '主键' });
    expect(metaMap.email).toMatchObject({ type: 'varchar(64)', key: 'UNI' });
    expect(hasUsableColumnMeta(metaMap)).toBe(true);
  });

  it('still omits blank generated columns from inserts', () => {
    expect(shouldOmitBlankDataGridInsertValue('', 'insert', {
      extra: 'auto_increment',
      hasDefault: true,
      default: "nextval('users_id_seq'::regclass)",
    })).toBe(true);
    expect(shouldOmitBlankDataGridInsertValue('', 'update', {
      extra: 'auto_increment',
    })).toBe(false);
  });
});
