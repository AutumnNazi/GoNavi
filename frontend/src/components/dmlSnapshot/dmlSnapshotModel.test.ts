import { describe, expect, it } from 'vitest';
import {
  buildReverseScript,
  countReverseStatements,
  normalizeDMLSnapshotDetail,
  normalizeDMLSnapshotList,
} from './dmlSnapshotModel';

describe('normalizeDMLSnapshotList', () => {
  it('收敛后端字段并丢弃没有 id 的记录', () => {
    const result = normalizeDMLSnapshotList([
      {
        id: 'snap-1',
        createdAt: '2026-09-20T10:00:00Z',
        table: 't_pay',
        connection: 'conn-1',
        driver: 'mysql',
        dbName: 'shop',
        cannotFullyRestore: true,
        skippedCount: '2',
        statementCount: 3,
      },
      { id: '   ', table: 'ignored' },
      null,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'snap-1',
      table: 't_pay',
      // 字符串数字必须收敛成 number，否则表格排序与计数展示会出错。
      skippedCount: 2,
      statementCount: 3,
      cannotFullyRestore: true,
    });
  });

  it('非数组输入返回空列表而不是抛错', () => {
    expect(normalizeDMLSnapshotList(undefined)).toEqual([]);
    expect(normalizeDMLSnapshotList({})).toEqual([]);
  });
});

describe('normalizeDMLSnapshotDetail', () => {
  it('保留三段反向语句并归一化 skipped', () => {
    const detail = normalizeDMLSnapshotDetail({
      id: 'snap-2',
      table: 't_pay',
      deletes: ['DELETE FROM `t_pay` WHERE `id` = 100;'],
      updates: ['UPDATE `t_pay` SET `name` = \'old\' WHERE `id` = 7;'],
      inserts: [],
      skipped: [{ group: 'insert', index: 0, reason: 'data_grid.reverse.skip.missing_locator' }],
      cannotFullyRestore: true,
    });

    expect(detail.deletes).toHaveLength(1);
    expect(detail.updates).toHaveLength(1);
    expect(detail.inserts).toEqual([]);
    expect(detail.skipped).toEqual([
      { group: 'insert', index: 0, reason: 'data_grid.reverse.skip.missing_locator' },
    ]);
    expect(countReverseStatements(detail)).toBe(2);
  });

  it('过滤空语句，避免脚本里出现空行', () => {
    const detail = normalizeDMLSnapshotDetail({
      id: 'snap-3',
      deletes: ['', '   ', 'DELETE FROM t WHERE id = 1;'],
    });
    expect(detail.deletes).toEqual(['DELETE FROM t WHERE id = 1;']);
  });
});

describe('buildReverseScript', () => {
  it('按 撤销新增 → 还原修改 → 补回删除 的顺序输出', () => {
    const detail = normalizeDMLSnapshotDetail({
      id: 'snap-4',
      deletes: ['DELETE_FROM_INSERTS;'],
      updates: ['RESTORE_UPDATE;'],
      inserts: ['RESTORE_DELETE;'],
    });

    const script = buildReverseScript(detail);
    // 顺序是安全性要求：先 INSERT 再 DELETE 同一行会造成主键冲突。
    expect(script.indexOf('DELETE_FROM_INSERTS;')).toBeLessThan(script.indexOf('RESTORE_UPDATE;'));
    expect(script.indexOf('RESTORE_UPDATE;')).toBeLessThan(script.indexOf('RESTORE_DELETE;'));
  });

  it('跳过没有语句的分组，不产出空标题', () => {
    const detail = normalizeDMLSnapshotDetail({
      id: 'snap-5',
      updates: ['ONLY_UPDATE;'],
    });
    const script = buildReverseScript(detail);
    expect(script).toContain('ONLY_UPDATE;');
    expect(script).not.toContain('undo inserts');
    expect(script).not.toContain('restore deletes');
  });

  it('空详情产出空脚本', () => {
    const detail = normalizeDMLSnapshotDetail({ id: 'snap-6' });
    expect(buildReverseScript(detail)).toBe('');
    expect(countReverseStatements(detail)).toBe(0);
  });
});
