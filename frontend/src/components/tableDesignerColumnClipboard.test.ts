import { afterEach, describe, expect, it } from 'vitest';

import {
  applyTableDesignerColumnPaste,
  cloneTableDesignerColumnsForPaste,
  parseTableDesignerColumns,
  readTableDesignerColumnsClipboard,
  recallTableDesignerColumnsClipboard,
  resetTableDesignerColumnsClipboardMemory,
  serializeTableDesignerColumns,
  TABLE_DESIGNER_COLUMN_CLIPBOARD_PREFIX,
  writeTableDesignerColumnsClipboard,
  type TableDesignerClipboardColumn,
} from './tableDesignerColumnClipboard';

const column = (overrides: Partial<TableDesignerClipboardColumn> = {}): TableDesignerClipboardColumn => ({
  _key: 'column-1',
  name: 'created_at',
  type: 'datetime',
  nullable: 'NO',
  key: '',
  extra: 'DEFAULT_GENERATED',
  comment: '创建时间',
  default: 'CURRENT_TIMESTAMP',
  hasDefault: true,
  charset: 'utf8mb4',
  collation: 'utf8mb4_bin',
  isAutoIncrement: false,
  ...overrides,
});

describe('tableDesignerColumnClipboard', () => {
  afterEach(() => {
    resetTableDesignerColumnsClipboardMemory();
  });
  it('serializes and parses column definitions without UI keys', () => {
    const text = serializeTableDesignerColumns([column()]);
    expect(text.startsWith(TABLE_DESIGNER_COLUMN_CLIPBOARD_PREFIX)).toBe(true);
    expect(text).not.toContain('column-1');
    expect(parseTableDesignerColumns(text)).toEqual([expect.objectContaining({
      name: 'created_at',
      type: 'datetime',
      default: 'CURRENT_TIMESTAMP',
      charset: 'utf8mb4',
    })]);
  });

  it('rejects ordinary, malformed, and incomplete clipboard text', () => {
    expect(parseTableDesignerColumns('created_at')).toBeNull();
    expect(parseTableDesignerColumns(`${TABLE_DESIGNER_COLUMN_CLIPBOARD_PREFIX}{`)).toBeNull();
    expect(parseTableDesignerColumns(`${TABLE_DESIGNER_COLUMN_CLIPBOARD_PREFIX}${JSON.stringify({ version: 1, columns: [{ name: 'id' }] })}`)).toBeNull();
  });

  it('clones columns at the end with preserved definitions and unique names', () => {
    const pasted = cloneTableDesignerColumnsForPaste(
      [column({ name: 'id' }), column({ name: 'ID' })],
      [column({ name: 'id' }), column({ name: 'id_copy' })],
    );

    expect(pasted).toHaveLength(2);
    expect(pasted.map(item => item.name)).toEqual(['id_copy_2', 'ID_copy_3']);
    expect(pasted.every(item => item.isNew && item._key && item._key !== 'column-1')).toBe(true);
    expect(pasted[0]).toEqual(expect.objectContaining({
      type: 'datetime',
      nullable: 'NO',
      default: 'CURRENT_TIMESTAMP',
      hasDefault: true,
      extra: 'DEFAULT_GENERATED',
      comment: '创建时间',
    }));
  });

  it('keeps original names when pasting into a table without conflicts', () => {
    const pasted = cloneTableDesignerColumnsForPaste(
      [column({ name: 'created_at' }), column({ name: 'updated_at' })],
      [column({ name: 'id' })],
    );

    expect(pasted.map(item => item.name)).toEqual(['created_at', 'updated_at']);
    expect(pasted.every(item => item.isNew)).toBe(true);
  });

  it('strips primary key and auto-increment when the current table already has a primary key', () => {
    const result = applyTableDesignerColumnPaste(
      [column({
        name: 'id',
        type: 'bigint',
        key: 'PRI',
        isAutoIncrement: true,
        extra: '',
        default: "nextval('lab_customers_id_seq'::regclass)",
        hasDefault: true,
        comment: '客户ID，主键自增',
      })],
      [column({ name: 'id', type: 'bigint', key: 'PRI', isAutoIncrement: true })],
    );

    expect(result.renamedCount).toBe(1);
    expect(result.strippedPrimaryKey).toBe(true);
    expect(result.columns[0]).toEqual(expect.objectContaining({
      name: 'id_copy',
      key: '',
      isAutoIncrement: false,
      default: "nextval('lab_customers_id_seq'::regclass)",
    }));
  });

  it('keeps primary key when pasting into a table without one', () => {
    const result = applyTableDesignerColumnPaste(
      [column({ name: 'id', type: 'bigint', key: 'PRI', isAutoIncrement: true, extra: 'auto_increment' })],
      [column({ name: 'name', key: '' })],
    );

    expect(result.strippedPrimaryKey).toBe(false);
    expect(result.columns[0]).toEqual(expect.objectContaining({
      name: 'id',
      key: 'PRI',
      isAutoIncrement: true,
    }));
  });

  it('writes and reads the custom clipboard payload', async () => {
    const written: string[] = [];
    const result = await writeTableDesignerColumnsClipboard([column()], {
      writeText: async (text) => { written.push(text); },
    });
    expect(result).toBe('ok');
    expect(parseTableDesignerColumns(written[0] || '')?.[0]?.name).toBe('created_at');

    const parsed = await readTableDesignerColumnsClipboard({
      readText: async () => written[0] || '',
    });
    expect(parsed).toEqual([expect.objectContaining({ name: 'created_at', type: 'datetime' })]);
    expect(recallTableDesignerColumnsClipboard()?.[0]?.name).toBe('created_at');
  });
});
