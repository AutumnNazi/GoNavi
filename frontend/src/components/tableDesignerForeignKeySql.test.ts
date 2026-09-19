import { describe, expect, it } from 'vitest';

import {
  buildCreateTableForeignKeyStatements,
  buildForeignKeyAddSql,
  buildForeignKeyDropSql,
} from './tableDesignerForeignKeySql';
import {
  removeForeignKeyDefinitionsByName,
  replaceForeignKeyDefinitionsFromForm,
  toForeignKeySqlForms,
} from './tableDesignerForeignKeyUtils';

const userFk = {
  constraintName: 'fk_orders_user',
  columnNames: ['user_id'],
  refTableName: 'users',
  refColumnNames: ['id'],
};

describe('tableDesignerForeignKeySql', () => {
  it('builds MySQL add and drop foreign key SQL', () => {
    expect(buildForeignKeyAddSql({
      dbType: 'mysql',
      tableRef: '`orders`',
      form: userFk,
    })).toBe('ALTER TABLE `orders`\nADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);');

    expect(buildForeignKeyDropSql({
      dbType: 'mysql',
      tableRef: '`orders`',
      constraintName: 'fk_orders_user',
    })).toBe('ALTER TABLE `orders`\nDROP FOREIGN KEY `fk_orders_user`;');
  });

  it('builds postgres drop constraint SQL and keeps an explicit ref schema', () => {
    expect(buildForeignKeyAddSql({
      dbType: 'kingbase',
      tableRef: 'public.orders',
      schema: 'public',
      form: {
        ...userFk,
        refTableName: 'auth.users',
      },
    })).toBe('ALTER TABLE public.orders\nADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES auth.users (id);');

    expect(buildForeignKeyDropSql({
      dbType: 'postgres',
      tableRef: 'public.orders',
      constraintName: 'fk_orders_user',
    })).toBe('ALTER TABLE public.orders\nDROP CONSTRAINT fk_orders_user;');
  });

  it('joins create-table foreign key statements', () => {
    expect(buildCreateTableForeignKeyStatements({
      dbType: 'mysql',
      tableRef: '`orders`',
      foreignKeys: [userFk, {
        constraintName: 'fk_orders_shop',
        columnNames: ['shop_id'],
        refTableName: 'shops',
        refColumnNames: ['id'],
      }],
    })).toContain('ADD CONSTRAINT `fk_orders_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`);');
  });
});

describe('tableDesignerForeignKeyUtils', () => {
  it('replaces and removes draft foreign key rows', () => {
    const created = replaceForeignKeyDefinitionsFromForm([], undefined, {
      constraintName: 'fk_orders_user',
      columnNames: ['user_id', 'tenant_id'],
      refTableName: 'users',
      refColumnNames: ['id', 'tenant_id'],
    });
    expect(created).toEqual([
      {
        name: 'fk_orders_user',
        constraintName: 'fk_orders_user',
        columnName: 'user_id',
        refTableName: 'users',
        refColumnName: 'id',
      },
      {
        name: 'fk_orders_user',
        constraintName: 'fk_orders_user',
        columnName: 'tenant_id',
        refTableName: 'users',
        refColumnName: 'tenant_id',
      },
    ]);

    const renamed = replaceForeignKeyDefinitionsFromForm(created, 'fk_orders_user', userFk);
    expect(renamed).toEqual([{
      name: 'fk_orders_user',
      constraintName: 'fk_orders_user',
      columnName: 'user_id',
      refTableName: 'users',
      refColumnName: 'id',
    }]);
    expect(removeForeignKeyDefinitionsByName(renamed, 'fk_orders_user')).toEqual([]);
  });

  it('maps display rows back to SQL forms', () => {
    expect(toForeignKeySqlForms([{
      constraintName: 'fk_orders_user',
      columnNames: ['user_id'],
      refTableName: '-',
      refColumnNames: ['id'],
    }])).toEqual([{
      constraintName: 'fk_orders_user',
      columnNames: ['user_id'],
      refTableName: '',
      refColumnNames: ['id'],
    }]);
  });
});
