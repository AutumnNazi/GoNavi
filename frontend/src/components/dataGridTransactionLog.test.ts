import { describe, expect, it } from 'vitest';

import { buildDataGridTransactionLog } from './dataGridTransactionLog';

describe('buildDataGridTransactionLog', () => {
  it('records the complete committed transaction instead of row-count placeholders', () => {
    expect(buildDataGridTransactionLog({
      dbType: 'mysql',
      tableName: 'users',
      preview: {
        deletes: ['DELETE FROM `users` WHERE `id` = 7;'],
        updates: ["UPDATE `users` SET `name` = 'new-name' WHERE `id` = 8;"],
        inserts: ["INSERT INTO `users` (`id`, `name`) VALUES (9, 'created');"],
      },
      committed: true,
    })).toBe([
      '/* Batch Apply on users */',
      'START TRANSACTION;',
      'DELETE FROM `users` WHERE `id` = 7;',
      "UPDATE `users` SET `name` = 'new-name' WHERE `id` = 8;",
      "INSERT INTO `users` (`id`, `name`) VALUES (9, 'created');",
      'COMMIT;',
    ].join('\n'));
  });

  it('keeps failed transactions inspectable without claiming that they committed', () => {
    const sql = buildDataGridTransactionLog({
      dbType: 'postgres',
      tableName: 'users',
      preview: { updates: ["UPDATE \"users\" SET \"name\" = 'failed' WHERE \"id\" = 8;"] },
      committed: false,
    });

    expect(sql).toContain('BEGIN;');
    expect(sql).toContain("UPDATE \"users\" SET \"name\" = 'failed' WHERE \"id\" = 8;");
    expect(sql).not.toContain('COMMIT;');
    expect(sql).toContain('-- COMMIT was not issued because this batch failed.');
  });

  it('marks unknown commit outcomes as unsafe to replay instead of unissued', () => {
    const sql = buildDataGridTransactionLog({
      dbType: 'mysql',
      tableName: 'users',
      preview: { inserts: ["INSERT INTO `users` (`id`) VALUES (1);"] },
      committed: false,
      outcomeUnknown: true,
    });

    expect(sql).toContain('START TRANSACTION;');
    expect(sql).toContain("INSERT INTO `users` (`id`) VALUES (1);");
    expect(sql).not.toContain('COMMIT;');
    expect(sql).toContain('-- COMMIT outcome is unknown; do not replay this batch.');
    expect(sql).not.toContain('-- COMMIT was not issued because this batch failed.');
  });

  it('uses Caché transaction boundaries for committed data-grid changes', () => {
    expect(buildDataGridTransactionLog({
      dbType: 'cache',
      tableName: 'Sample.Person',
      preview: { updates: ['UPDATE Sample.Person SET Name = \'next\' WHERE ID = 1;'] },
      committed: true,
    })).toContain("BEGIN;\nUPDATE Sample.Person SET Name = 'next' WHERE ID = 1;\nCOMMIT;");
  });
});
