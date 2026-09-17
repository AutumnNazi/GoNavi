import { describe, expect, it } from 'vitest';

import type { TableDesignerClipboardColumn } from './tableDesignerColumnClipboard';
import {
  buildCopyColumnsToExistingTablePlan,
  isSameTableDesignerTable,
  mapMetadataRowsToDesignerColumns,
  stripPrimaryKeyFromCopiedColumns,
  targetTableHasPrimaryKey,
} from './tableDesignerCopyColumnsToTable';
import type { EditableColumnSnapshot } from './tableDesignerSchemaSql';

const snapshot = (overrides: Partial<EditableColumnSnapshot>): EditableColumnSnapshot => ({
  _key: overrides._key ?? 'col',
  name: overrides.name ?? 'id',
  type: overrides.type ?? 'int',
  nullable: overrides.nullable ?? 'NO',
  extra: overrides.extra ?? '',
  comment: overrides.comment ?? '',
  key: overrides.key ?? '',
  default: overrides.default,
  hasDefault: overrides.hasDefault,
  charset: overrides.charset,
  collation: overrides.collation,
  isAutoIncrement: overrides.isAutoIncrement ?? false,
});

const copied = (overrides: Partial<TableDesignerClipboardColumn> = {}): TableDesignerClipboardColumn => ({
  name: 'created_at',
  type: 'datetime',
  nullable: 'NO',
  key: '',
  extra: '',
  comment: '创建时间',
  default: 'CURRENT_TIMESTAMP',
  hasDefault: true,
  ...overrides,
});

describe('tableDesignerCopyColumnsToTable', () => {
  it('treats unqualified and schema-qualified names as the same table', () => {
    expect(isSameTableDesignerTable('users', 'public.users', 'postgres')).toBe(true);
    expect(isSameTableDesignerTable('public.users', 'other.users', 'postgres')).toBe(false);
    expect(isSameTableDesignerTable('orders', 'users')).toBe(false);
  });

  it('maps metadata rows into designer columns', () => {
    const columns = mapMetadataRowsToDesignerColumns([
      { name: 'id', type: 'int', nullable: 'NO', key: 'PRI', extra: 'auto_increment', comment: '' },
    ]);
    expect(columns[0]).toEqual(expect.objectContaining({
      name: 'id',
      key: 'PRI',
      isAutoIncrement: true,
    }));
    expect(columns[0]?._key).toContain('id');
  });

  it('builds ADD COLUMN SQL and keeps original names when there is no conflict', () => {
    const plan = buildCopyColumnsToExistingTablePlan({
      dbType: 'mysql',
      tableName: 'orders',
      targetColumns: [snapshot({ _key: 'id', name: 'id', key: 'PRI' })],
      copiedColumns: [copied()],
    });

    expect(plan.renamedCount).toBe(0);
    expect(plan.strippedPrimaryKey).toBe(false);
    expect(plan.pastedColumns[0]?.name).toBe('created_at');
    expect(plan.sql).toContain('ALTER TABLE `orders`');
    expect(plan.sql).toContain('ADD COLUMN `created_at` datetime');
    expect(plan.sql).not.toContain('DROP COLUMN');
    expect(plan.sql).not.toContain('DROP PRIMARY KEY');
  });

  it('renames conflicting columns and strips primary key from copies', () => {
    const plan = buildCopyColumnsToExistingTablePlan({
      dbType: 'mysql',
      tableName: 'users',
      targetColumns: [
        snapshot({ _key: 'id', name: 'id', key: 'PRI', isAutoIncrement: true, extra: 'auto_increment' }),
      ],
      copiedColumns: [copied({ name: 'id', key: 'PRI', isAutoIncrement: true, extra: 'auto_increment' })],
    });

    expect(plan.renamedCount).toBe(1);
    expect(plan.pastedColumns[0]?.name).toBe('id_copy');
    expect(plan.pastedColumns[0]?.key).toBe('');
    expect(plan.pastedColumns[0]?.isAutoIncrement).toBe(false);
    expect(plan.sql).toContain('ADD COLUMN `id_copy`');
    expect(plan.sql).not.toContain('DROP PRIMARY KEY');
  });

  it('keeps primary key when the target table has none', () => {
    const pasted = stripPrimaryKeyFromCopiedColumns([
      snapshot({ _key: 'id', name: 'id', key: 'PRI', isAutoIncrement: true, extra: 'auto_increment' }),
    ]);
    expect(targetTableHasPrimaryKey([snapshot({ _key: 'name', name: 'name', key: '' })])).toBe(false);
    expect(pasted[0]).toEqual(expect.objectContaining({
      key: '',
      isAutoIncrement: false,
    }));

    const plan = buildCopyColumnsToExistingTablePlan({
      dbType: 'mysql',
      tableName: 'logs',
      targetColumns: [snapshot({ _key: 'message', name: 'message', key: '' })],
      copiedColumns: [copied({ name: 'id', key: 'PRI', type: 'int', isAutoIncrement: true, extra: 'auto_increment' })],
    });
    expect(plan.strippedPrimaryKey).toBe(false);
    expect(plan.pastedColumns[0]?.key).toBe('PRI');
    expect(plan.sql).toContain('ADD PRIMARY KEY (`id`)');
  });
});
