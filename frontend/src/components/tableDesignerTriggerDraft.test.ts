import { describe, expect, it } from 'vitest';

import {
  buildTableDesignerTriggerTemplate,
  collectCreateTableTriggerSql,
  parseTriggerDraftFromSql,
  removeTriggerDraftByName,
  replaceTriggerDrafts,
} from './tableDesignerTriggerDraft';

const mysqlTriggerSql = `CREATE TRIGGER trg_orders_bi
BEFORE INSERT ON \`orders\`
FOR EACH ROW
BEGIN
    SET NEW.user_id = NEW.user_id;
END;`;

const pgTriggerSql = `CREATE OR REPLACE FUNCTION trg_orders_bi_fn()
RETURNS TRIGGER AS $$
BEGIN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_bi
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION trg_orders_bi_fn();`;

describe('tableDesignerTriggerDraft', () => {
  it('parses MySQL and postgres trigger drafts from SQL', () => {
    expect(parseTriggerDraftFromSql(mysqlTriggerSql)).toEqual({
      name: 'trg_orders_bi',
      timing: 'BEFORE',
      event: 'INSERT',
      statement: mysqlTriggerSql,
    });

    expect(parseTriggerDraftFromSql(pgTriggerSql)).toMatchObject({
      name: 'trg_orders_bi',
      timing: 'BEFORE',
      event: 'INSERT',
      statement: pgTriggerSql,
    });
  });

  it('replaces and removes trigger drafts by name', () => {
    const created = replaceTriggerDrafts([], undefined, {
      name: 'trg_orders_bi',
      timing: 'BEFORE',
      event: 'INSERT',
      statement: mysqlTriggerSql,
    });
    const renamed = replaceTriggerDrafts(created, 'trg_orders_bi', {
      name: 'trg_orders_ai',
      timing: 'AFTER',
      event: 'INSERT',
      statement: mysqlTriggerSql.replace('trg_orders_bi', 'trg_orders_ai').replace('BEFORE', 'AFTER'),
    });
    expect(renamed.map((row) => row.name)).toEqual(['trg_orders_ai']);
    expect(removeTriggerDraftByName(renamed, 'trg_orders_ai')).toEqual([]);
  });

  it('collects trigger SQL for create-table preview', () => {
    expect(collectCreateTableTriggerSql([
      { name: 'a', timing: 'BEFORE', event: 'INSERT', statement: mysqlTriggerSql },
      { name: 'b', timing: 'BEFORE', event: 'INSERT', statement: pgTriggerSql },
    ])).toBe(`${mysqlTriggerSql}\n\n${pgTriggerSql}`);
  });

  it('builds a kingbase trigger template against the preview table', () => {
    const sql = buildTableDesignerTriggerTemplate('kingbase', 'public.orders');
    expect(sql).toContain('CREATE TRIGGER trigger_name');
    expect(sql).toContain('BEFORE INSERT ON public.orders');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION trigger_function_name()');
  });
});
