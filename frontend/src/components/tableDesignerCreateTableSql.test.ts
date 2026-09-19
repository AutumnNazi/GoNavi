import { describe, expect, it } from 'vitest';

import { buildNewTablePreviewSql } from './tableDesignerCreateTableSql';
import { applyCreateTableCommentSql, buildAlterTableCommentSql } from './tableDesignerTableCommentSql';
import { buildCreateTableIndexStatements } from './tableDesignerIndexSql';
import {
  applyPrimaryIndexToColumnKeys,
  removeIndexDefinitionsByNames,
  replaceIndexDefinitionsFromForm,
  type IndexFormSnapshot,
} from './tableDesignerIndexUtils';
import type { EditableColumnSnapshot } from './tableDesignerSchemaSql';

const baseColumn = (overrides: Partial<EditableColumnSnapshot>): EditableColumnSnapshot => ({
  _key: overrides._key ?? 'col',
  name: overrides.name ?? 'id',
  type: overrides.type ?? 'int',
  nullable: overrides.nullable ?? 'NO',
  default: Object.prototype.hasOwnProperty.call(overrides, 'default') ? overrides.default : undefined,
  hasDefault: Object.prototype.hasOwnProperty.call(overrides, 'hasDefault')
    ? overrides.hasDefault
    : overrides.default !== undefined && overrides.default !== null && String(overrides.default).trim().length > 0,
  extra: overrides.extra ?? '',
  comment: overrides.comment ?? '',
  key: overrides.key ?? '',
  charset: overrides.charset,
  collation: overrides.collation,
  isAutoIncrement: overrides.isAutoIncrement ?? false,
});

const uniqueNameIndex = (): IndexFormSnapshot => ({
  name: 'idx_users_name',
  columnNames: ['name'],
  kind: 'NORMAL',
  indexType: 'DEFAULT',
});

describe('tableDesignerCreateTableSql', () => {
  it('keeps an unchanged create table SQL when comment and indexes are empty', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'mysql',
      tableName: 'users',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      columns: [
        baseColumn({ _key: 'id', name: 'id', key: 'PRI' }),
        baseColumn({ _key: 'name', name: 'name', type: 'varchar(50)', nullable: 'YES' }),
      ],
    });

    expect(sql).toContain('CREATE TABLE `users`');
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).not.toContain('COMMENT=');
    expect(sql).not.toContain('ADD INDEX');
  });

  it('embeds a MySQL table comment and secondary indexes into create preview SQL', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'mysql',
      tableName: 'users',
      charset: 'utf8mb4',
      columns: [
        baseColumn({ _key: 'id', name: 'id', key: 'PRI' }),
        baseColumn({ _key: 'name', name: 'name', type: 'varchar(50)', nullable: 'YES' }),
      ],
      comment: "user's table",
      indexes: [
        uniqueNameIndex(),
        {
          name: 'uk_users_name',
          columnNames: ['name'],
          kind: 'UNIQUE',
          indexType: 'BTREE',
        },
        {
          name: 'PRIMARY',
          columnNames: ['id'],
          kind: 'PRIMARY',
          indexType: 'BTREE',
        },
      ],
    });

    expect(sql).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='user''s table';");
    expect(sql).toContain('PRIMARY KEY (`id`)');
    expect(sql).toContain('ALTER TABLE `users`\nADD INDEX `idx_users_name` (`name`);');
    expect(sql).toContain('ALTER TABLE `users`\nADD UNIQUE INDEX `uk_users_name` USING BTREE (`name`);');
    expect(sql).not.toContain('ADD PRIMARY KEY');
  });

  it('appends COMMENT ON TABLE after postgres create table', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'postgres',
      tableName: 'public.users',
      columns: [
        baseColumn({ _key: 'id', name: 'id', type: 'int', key: 'PRI' }),
        baseColumn({ _key: 'name', name: 'name', type: 'varchar(50)', nullable: 'YES', comment: '姓名' }),
      ],
      comment: '用户表',
      indexes: [uniqueNameIndex()],
    });

    expect(sql).toContain('CREATE TABLE public.users');
    expect(sql).toContain("COMMENT ON TABLE public.users IS '用户表';");
    expect(sql).toContain("COMMENT ON COLUMN public.users.name IS '姓名';");
    expect(sql).toContain('CREATE INDEX idx_users_name ON public.users (name);');
  });

  it('adds SQL Server extended property after create table', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'sqlserver',
      tableName: 'dbo.Users',
      columns: [baseColumn({ _key: 'id', name: 'id', type: 'int', key: 'PRI' })],
      comment: 'Users',
    });

    expect(sql).toContain('CREATE TABLE [dbo].[Users]');
    expect(sql).toContain("EXEC sp_addextendedproperty");
    expect(sql).toContain("@value = N'Users'");
    expect(sql).toContain("@level1name = N'Users'");
  });

  it('places a StarRocks table comment after the key clause', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'starrocks',
      tableName: 'sales.orders',
      columns: [
        baseColumn({ _key: 'id', name: 'id', type: 'BIGINT', key: 'PRI' }),
        baseColumn({ _key: 'amount', name: 'amount', type: 'DECIMAL(10,2)', nullable: 'YES' }),
      ],
      comment: '订单表',
    });

    expect(sql).toContain('ENGINE=OLAP');
    expect(sql).toContain('DUPLICATE KEY (`id`)\nCOMMENT \'订单表\'');
    expect(sql).toContain('DISTRIBUTED BY HASH(`id`) BUCKETS AUTO');
  });

  it('uses PRIMARY index columns when building create table primary key', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'mysql',
      tableName: 'users',
      columns: [
        baseColumn({ _key: 'id', name: 'id' }),
        baseColumn({ _key: 'email', name: 'email', type: 'varchar(100)', nullable: 'YES' }),
      ],
      indexes: [{
        name: 'PRIMARY',
        columnNames: ['email'],
        kind: 'PRIMARY',
        indexType: 'BTREE',
      }],
    });

    expect(sql).toContain('PRIMARY KEY (`email`)');
    expect(sql).not.toContain('PRIMARY KEY (`id`)');
  });

  it('appends foreign keys and triggers after create table', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'mysql',
      tableName: 'orders',
      charset: 'utf8mb4',
      columns: [
        baseColumn({ _key: 'id', name: 'id', key: 'PRI' }),
        baseColumn({ _key: 'user_id', name: 'user_id', type: 'int' }),
      ],
      foreignKeys: [{
        constraintName: 'fk_orders_user',
        columnNames: ['user_id'],
        refTableName: 'users',
        refColumnNames: ['id'],
      }],
      triggers: [{
        name: 'trg_orders_bi',
        timing: 'BEFORE',
        event: 'INSERT',
        statement: `CREATE TRIGGER trg_orders_bi
BEFORE INSERT ON \`orders\`
FOR EACH ROW
BEGIN
    SET NEW.user_id = NEW.user_id;
END;`,
      }],
    });

    expect(sql).toContain('CREATE TABLE `orders`');
    expect(sql).toContain('ALTER TABLE `orders`\nADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);');
    expect(sql).toContain('CREATE TRIGGER trg_orders_bi');
  });

  it('qualifies postgres foreign key references with the create-table schema', () => {
    const sql = buildNewTablePreviewSql({
      dbType: 'postgres',
      tableName: 'public.orders',
      columns: [
        baseColumn({ _key: 'id', name: 'id', type: 'int', key: 'PRI' }),
        baseColumn({ _key: 'user_id', name: 'user_id', type: 'int' }),
      ],
      foreignKeys: [{
        constraintName: 'fk_orders_user',
        columnNames: ['user_id'],
        refTableName: 'users',
        refColumnNames: ['id'],
      }],
    });

    expect(sql).toContain('CREATE TABLE public.orders');
    expect(sql).toContain('ALTER TABLE public.orders\nADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES public.users (id);');
  });
});

describe('tableDesignerTableCommentSql', () => {
  it('builds MySQL alter table comment SQL', () => {
    expect(buildAlterTableCommentSql({
      dbType: 'mysql',
      tableRef: '`users`',
    }, '用户表')).toBe("ALTER TABLE `users` COMMENT = '用户表';");
  });

  it('does not inject comments for sqlite create table', () => {
    const sql = applyCreateTableCommentSql(
      'CREATE TABLE "users" (\n  "id" INTEGER\n);',
      'sqlite',
      'users',
      'ignored',
    );
    expect(sql).toBe('CREATE TABLE "users" (\n  "id" INTEGER\n);');
    expect(sql).not.toContain('COMMENT');
  });
});

describe('tableDesigner create-table index helpers', () => {
  it('skips PRIMARY when generating follow-up index statements', () => {
    const sql = buildCreateTableIndexStatements({
      dbType: 'mysql',
      tableRef: '`users`',
      indexes: [
        { name: 'PRIMARY', columnNames: ['id'], kind: 'PRIMARY', indexType: 'BTREE' },
        { name: 'idx_users_name', columnNames: ['name'], kind: 'NORMAL', indexType: 'DEFAULT' },
      ],
    });

    expect(sql).toBe('ALTER TABLE `users`\nADD INDEX `idx_users_name` (`name`);');
  });

  it('replaces and removes draft index definitions', () => {
    const created = replaceIndexDefinitionsFromForm([], undefined, uniqueNameIndex());
    expect(created).toEqual([{
      name: 'idx_users_name',
      columnName: 'name',
      nonUnique: 1,
      seqInIndex: 1,
      indexType: '',
    }]);

    const renamed = replaceIndexDefinitionsFromForm(created, 'idx_users_name', {
      ...uniqueNameIndex(),
      name: 'idx_users_display_name',
      columnNames: ['name', 'email'],
    });
    expect(renamed.map((row) => row.name)).toEqual(['idx_users_display_name', 'idx_users_display_name']);
    expect(removeIndexDefinitionsByNames(renamed, ['idx_users_display_name'])).toEqual([]);
  });

  it('syncs column primary keys from a PRIMARY index draft', () => {
    const columns = [
      { name: 'id', key: 'PRI' },
      { name: 'email', key: '' },
    ];
    expect(applyPrimaryIndexToColumnKeys(columns, ['email'])).toEqual([
      { name: 'id', key: '' },
      { name: 'email', key: 'PRI' },
    ]);
  });
});
