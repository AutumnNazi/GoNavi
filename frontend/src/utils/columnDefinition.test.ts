import { describe, expect, it } from 'vitest';

import {
  getColumnDefinitionComment,
  getColumnDefinitionKey,
  getColumnDefinitionName,
  getColumnDefinitionType,
  normalizeMySQLUnsignedColumnType,
  normalizeColumnDefinition,
  setMySQLUnsignedColumnType,
  supportsMySQLUnsignedDialect,
  supportsMySQLUnsignedColumnType,
} from './columnDefinition';

describe('columnDefinition metadata normalization', () => {
  it('reads Go/Wails style column metadata fields', () => {
    const column = { Name: 'UPDATED_AT', Type: 'TIMESTAMP', Key: 'PRI', Comment: '更新时间' };

    expect(getColumnDefinitionName(column)).toBe('UPDATED_AT');
    expect(getColumnDefinitionType(column)).toBe('TIMESTAMP');
    expect(getColumnDefinitionKey(column)).toBe('PRI');
    expect(getColumnDefinitionComment(column)).toBe('更新时间');
  });

  it('reads Oracle dictionary style column metadata aliases', () => {
    const column = { COLUMN_NAME: 'UPDATED_AT', DATA_TYPE: 'TIMESTAMP', COLUMN_KEY: 'PRI', COMMENTS: '更新时间' };

    expect(normalizeColumnDefinition(column)).toMatchObject({
      name: 'UPDATED_AT',
      type: 'TIMESTAMP',
      key: 'PRI',
      comment: '更新时间',
    });
  });

  it('prefers complete column type aliases over base data type', () => {
    const column = {
      COLUMN_NAME: 'USER_NAME',
      DATA_TYPE: 'varchar',
      COLUMN_TYPE: 'varchar(64)',
      IS_NULLABLE: 'NO',
    };

    expect(normalizeColumnDefinition(column)).toMatchObject({
      name: 'USER_NAME',
      type: 'varchar(64)',
      nullable: 'NO',
    });
  });

  it('builds display type from base type and length metadata', () => {
    const column = {
      column_name: 'amount',
      data_type: 'decimal',
      numeric_precision: 10,
      numeric_scale: 2,
      is_nullable: 'YES',
    };

    expect(normalizeColumnDefinition(column)).toMatchObject({
      name: 'amount',
      type: 'decimal(10,2)',
      nullable: 'YES',
    });
  });

  it('normalizes Dameng style data length and nullable flags', () => {
    const column = {
      COLUMN_NAME: 'USER_NAME',
      DATA_TYPE: 'VARCHAR2',
      DATA_LENGTH: 64,
      NULLABLE: 'N',
    };

    expect(normalizeColumnDefinition(column)).toMatchObject({
      name: 'USER_NAME',
      type: 'VARCHAR2(64)',
      nullable: 'NO',
    });
  });

  it('preserves an explicitly enabled empty string default', () => {
    expect(normalizeColumnDefinition({
      Name: 'status',
      Type: 'varchar(32)',
      Default: '',
      HasDefault: true,
    })).toMatchObject({
      default: '',
      hasDefault: true,
    });
  });

  it('respects an explicitly disabled default', () => {
    expect(normalizeColumnDefinition({
      name: 'status',
      type: 'varchar(32)',
      default: 'active',
      hasDefault: false,
    })).toMatchObject({
      default: undefined,
      hasDefault: false,
    });
  });

  it('falls back to legacy non-empty defaults when hasDefault is absent', () => {
    expect(normalizeColumnDefinition({ name: 'status', type: 'varchar(32)', default: 'active' })).toMatchObject({
      default: 'active',
      hasDefault: true,
    });
    expect(normalizeColumnDefinition({ name: 'status', type: 'varchar(32)', default: '' })).toMatchObject({
      default: undefined,
      hasDefault: false,
    });
    expect(normalizeColumnDefinition({ name: 'status', type: 'varchar(32)', default: null })).toMatchObject({
      default: undefined,
      hasDefault: false,
    });
  });

  it('normalizes charset and collation metadata aliases', () => {
    expect(normalizeColumnDefinition({
      COLUMN_NAME: 'status',
      DATA_TYPE: 'varchar',
      CHARACTER_SET_NAME: 'utf8mb4',
      COLLATION_NAME: 'utf8mb4_unicode_ci',
    })).toMatchObject({
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
    });
  });

  it('maps boolean primary and unique metadata aliases to GoNavi keys', () => {
    expect(getColumnDefinitionKey({ column_name: 'id', isPrimary: true })).toBe('PRI');
    expect(getColumnDefinitionKey({ column_name: 'id', primary_key: 't' })).toBe('PRI');
    expect(getColumnDefinitionKey({ column_name: 'email', is_unique: 'yes' })).toBe('UNI');
    expect(getColumnDefinitionKey({ column_name: 'id', column_key: 'primary key' })).toBe('PRI');
  });

  it('separates the MySQL unsigned modifier from numeric column types', () => {
    expect(normalizeMySQLUnsignedColumnType('BIGINT(20) UNSIGNED ZEROFILL')).toEqual({
      type: 'BIGINT(20) ZEROFILL',
      unsigned: true,
    });
    expect(normalizeMySQLUnsignedColumnType('int zerofill').unsigned).toBe(true);
    for (const dialect of ['mysql', 'mariadb', 'tidb', 'oceanbase']) {
      expect(supportsMySQLUnsignedDialect(dialect)).toBe(true);
      expect(supportsMySQLUnsignedColumnType(dialect, 'bigint(20)')).toBe(true);
    }
    for (const dialect of ['oracle', 'starrocks', 'diros', 'sphinx']) {
      expect(supportsMySQLUnsignedDialect(dialect)).toBe(false);
      expect(supportsMySQLUnsignedColumnType(dialect, 'bigint')).toBe(false);
    }
    expect(supportsMySQLUnsignedColumnType('mysql', 'decimal(12, 2)')).toBe(false);
    expect(supportsMySQLUnsignedColumnType('mysql', 'float')).toBe(false);
    expect(supportsMySQLUnsignedColumnType('mysql', 'varchar(32)')).toBe(false);
    expect(normalizeMySQLUnsignedColumnType('decimal(12,2) unsigned')).toEqual({
      type: 'decimal(12,2) unsigned',
      unsigned: false,
    });
  });

  it('toggles MySQL unsigned without duplicating or applying it to text types', () => {
    expect(setMySQLUnsignedColumnType('int unsigned', true)).toBe('int unsigned');
    expect(setMySQLUnsignedColumnType('int unsigned', false)).toBe('int');
    expect(setMySQLUnsignedColumnType('int unsigned zerofill', true)).toBe('int unsigned zerofill');
    expect(setMySQLUnsignedColumnType('int unsigned zerofill', false)).toBe('int');
    expect(setMySQLUnsignedColumnType('int signed', true)).toBe('int unsigned');
    expect(setMySQLUnsignedColumnType('varchar(32)', true)).toBe('varchar(32)');
  });
});
