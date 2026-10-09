import { describe, expect, it } from 'vitest';

import {
    QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES,
    QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKBACK_LINES,
    resolveBoundedSqlStatementContext,
} from './queryEditorBoundedStatementContext';
import { resolveCurrentSqlStatementRange } from '../../utils/sqlStatementSelection';
import { resolveQueryEditorHoverTarget } from './queryEditorHoverTarget';

/** 全文扫描（执行路径同一套逻辑）的结果，用于验证窗口内结果与之一致。 */
const fullScanReference = (sql: string, cursorOffset: number, dbType = '') => {
    const text = String(sql || '').replace(/\r\n/g, '\n');
    const offset = Math.max(0, Math.min(text.length, cursorOffset));
    const range = resolveCurrentSqlStatementRange(text, offset, dbType);
    if (!range) return { prefixText: '', statementText: '' };
    return {
        prefixText: text.slice(range.start, offset),
        statementText: range.text || '',
    };
};

describe('resolveBoundedSqlStatementContext（有界语句上下文）', () => {
    it('分号边界：语句起点取最近的分号之后，不混入上一语句', () => {
        const sql = 'select * from t1 a;\nselect a.';
        const ctx = resolveBoundedSqlStatementContext(sql, sql.length);
        expect(ctx.prefixText).toBe('select a.');
        expect(ctx.statementText).toBe('select a.');
        expect(ctx.referenceText).toBe('select a.');
    });

    it('同一语句内：referenceText 覆盖 FROM 部分（含光标之后的语句剩余）', () => {
        const sql = 'select \nfrom t2 b';
        const cursor = 'select '.length;
        const ctx = resolveBoundedSqlStatementContext(sql, cursor);
        expect(ctx.prefixText).toBe('select ');
        expect(ctx.statementText).toContain('from t2 b');
        expect(ctx.referenceText).toContain('from t2 b');
    });

    it('长 SQL 中部：只扫窗口内，不回溯到文档开头（不受 LOOKBACK 行数之外的文本影响）', () => {
        const lines: string[] = [];
        for (let i = 0; i < 400; i += 1) lines.push('select c' + i + ' from t' + i);
        lines.push('sel');
        const sql = lines.join('\n');
        const ctx = resolveBoundedSqlStatementContext(sql, sql.length);
        // 窗口上限 200 行：文档开头与窗口外的行都不应进入上下文
        expect(ctx.prefixText.startsWith('select c0 from t0')).toBe(false);
        expect(ctx.prefixText).not.toContain('select c100 from t100');
        expect(ctx.prefixText.endsWith('sel')).toBe(true);
    });

    it('空行是语句硬边界：空行之前的语句不进入上下文', () => {
        const sql = 'select * from t1 a\nwhere a.x = 1\n\nselect ';
        const ctx = resolveBoundedSqlStatementContext(sql, sql.length);
        expect(ctx.prefixText).toBe('select ');
        expect(ctx.referenceText).toBe('select');
    });

    it('空行边界优先于行数上限：窗口内有空行时窗口起点停在空行之后', () => {
        const above: string[] = [];
        for (let i = 0; i < 10; i += 1) above.push('select c' + i + ' from t' + i);
        const sql = above.join('\n') + '\n\nselect * from t9\nwhere ';
        const ctx = resolveBoundedSqlStatementContext(sql, sql.length);
        expect(ctx.prefixText).toBe('select * from t9\nwhere ');
        expect(ctx.referenceText).not.toContain('t0');
    });

    it('向下前瞻有界：光标之后的语句部分最多覆盖 LOOKAHEAD 行', () => {
        const tail: string[] = [];
        for (let i = 0; i < QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES + 50; i += 1) {
            tail.push('and x' + i + ' = 1');
        }
        const sql = 'select ' + '\n' + tail.join('\n');
        const ctx = resolveBoundedSqlStatementContext(sql, 'select '.length);
        expect(ctx.statementText).not.toContain('x' + (QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES + 49));
    });

    it('向下遇空行截断：空行后的语句不进入 statementText', () => {
        const sql = 'select \nfrom t3\n\nselect * from t4';
        const ctx = resolveBoundedSqlStatementContext(sql, 'select '.length);
        expect(ctx.statementText).toContain('from t3');
        expect(ctx.statementText).not.toContain('t4');
    });

    it('CRLF 文档：偏移按规范化文本计算，结果文本不含 \\r', () => {
        const sql = 'select * from t1 a;\r\nselect a.';
        const normalized = sql.replace(/\r\n/g, '\n');
        const ctx = resolveBoundedSqlStatementContext(sql, normalized.length);
        expect(ctx.prefixText).toBe('select a.');
        expect(ctx.prefixText).not.toContain('\r');
    });

    it('字符串/注释中的分号不作为语句边界（复用词法扫描）', () => {
        const sql = "select ';' as s from t5 a\nwhere a.";
        const ctx = resolveBoundedSqlStatementContext(sql, sql.length);
        expect(ctx.referenceText).toContain('from t5 a');
    });

    it('空文档与纯空白文档：返回空上下文', () => {
        expect(resolveBoundedSqlStatementContext('', 0)).toEqual({
            prefixText: '', statementText: '', referenceText: '',
        });
        expect(resolveBoundedSqlStatementContext('   \n  \n', 5)).toEqual({
            prefixText: '', statementText: '', referenceText: '',
        });
    });

    it('光标越界时按文档尾部收敛，不抛异常', () => {
        const sql = 'select * from t6';
        const ctx = resolveBoundedSqlStatementContext(sql, 99999);
        expect(ctx.prefixText).toBe('select * from t6');
    });

    it('窗口行数上限常量存在且为正数', () => {
        expect(QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKBACK_LINES).toBeGreaterThan(0);
        expect(QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES).toBeGreaterThan(0);
    });

    it('窗口内结果与全文扫描一致（短文档 / 单语句）', () => {
        const samples: Array<{ sql: string; cursor: number }> = [
            { sql: 'select a. from users a', cursor: 'select a.'.length },
            { sql: 'select * from t1 a;\nselect a.', cursor: 'select * from t1 a;\nselect a.'.length },
            { sql: 'select 1;\n\nselect * from t2 b\nwhere b.', cursor: 'select 1;\n\nselect * from t2 b\nwhere b.'.length },
            { sql: "select ';' as s, a. from t3 a", cursor: "select ';' as s, a.".length },
            { sql: 'select * from t4 a -- c;\nwhere a.', cursor: 'select * from t4 a -- c;\nwhere a.'.length },
        ];
        samples.forEach(({ sql, cursor }) => {
            const bounded = resolveBoundedSqlStatementContext(sql, cursor);
            const reference = fullScanReference(sql, cursor);
            expect(bounded.prefixText).toBe(reference.prefixText);
            expect(bounded.statementText).toBe(reference.statementText);
        });
    });

    it('窗口内结果与全文扫描一致（多语句 + 各自光标位置）', () => {
        const sql = [
            'select a. from t1 a;',
            'select b. from t2 b;',
            'select c. from t3 c;',
        ].join('\n');
        const cursors = [
            sql.indexOf('a.') + 2,
            sql.indexOf('b.') + 2,
            sql.indexOf('c.') + 2,
        ];
        cursors.forEach((cursor) => {
            const bounded = resolveBoundedSqlStatementContext(sql, cursor);
            const reference = fullScanReference(sql, cursor);
            expect(bounded.prefixText).toBe(reference.prefixText);
            expect(bounded.statementText).toBe(reference.statementText);
        });
    });
});

/**
 * hover 端（queryEditorHoverTarget）把别名表与表引用扫描也接到了同一份有界文本上。
 * 这里只断言「接线是否真的生效」这一个可观测结果：跨语句的别名不该再泄漏到当前语句，
 * 而同一语句内的别名解析必须保持不变。
 */
describe('hover 别名扫描的有界化（接线校验）', () => {
    const hoverTables = [{ dbName: 'appdb', tableName: 'orders' }];
    const hoverColumns = [{ dbName: 'appdb', tableName: 'orders', name: 'name', type: 'varchar' }];

    const hoverWith = (sql: string, documentContext?: { text: string; offset: number }) => resolveQueryEditorHoverTarget(
        sql,
        'select a.name;',
        10,
        'appdb',
        ['appdb'],
        hoverTables,
        hoverColumns,
        [], [], [], [], [], [],
        false,
        documentContext,
        '',
        undefined,
        true,
        'mysql',
    );

    // 结果类型是判别联合，取 column 分支的字段前先收窄，否则 tableName/columnName 不可直接访问。
    const asColumnTarget = (target: ReturnType<typeof resolveQueryEditorHoverTarget>) => {
        if (target?.kind !== 'column') {
            throw new Error(`expected column hover target, got ${target?.kind ?? 'null'}`);
        }
        return target;
    };

    it('有界：当前语句没有 FROM 时，不再借用后续语句的别名', () => {
        const sql = 'select a.name;\nselect a.name from orders a';
        const offset = sql.indexOf('a.name') + 1;
        expect(hoverWith(sql, { text: sql, offset })).toBeNull();
    });

    it('对照：拿全文构建别名表时会被后续语句的别名覆盖（说明有界确实改变了行为）', () => {
        const sql = 'select a.name;\nselect a.name from orders a';
        expect(asColumnTarget(hoverWith(sql, undefined)).tableName).toBe('orders');
    });

    it('CRLF 文档下偏移换算正确：同一语句内的别名仍然解析成功', () => {
        const sql = 'select b.name from orders b;\r\nselect a.name from orders a\r\nwhere a.name = 1';
        const normalized = sql.replace(/\r\n/g, '\n');
        const offset = normalized.indexOf('a.name = 1') + 1;
        const target = resolveQueryEditorHoverTarget(
            sql,
            'where a.name = 1',
            8,
            'appdb',
            ['appdb'],
            hoverTables,
            hoverColumns,
            [], [], [], [], [], [],
            false,
            { text: sql, offset },
            '',
            undefined,
            true,
            'mysql',
        );
        expect(target?.kind).toBe('column');
        expect(asColumnTarget(target).tableName).toBe('orders');
        expect(asColumnTarget(target).columnName).toBe('name');
    });
});
