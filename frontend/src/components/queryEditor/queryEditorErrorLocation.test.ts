import { describe, expect, it, vi } from 'vitest';

import {
    createQueryEditorExecutionOrigin,
    mapSqlErrorLocationToOffset,
    offsetToMonacoPosition,
    parseSqlExecutionErrorLocation,
    resolveExecutionErrorStatementText,
    revealQueryEditorSqlErrorLocation,
    splitSqlErrorLocationText,
} from './queryEditorErrorLocation';

describe('query editor SQL error location', () => {
    it('parses Oracle error-occur-at-position offsets as 1-based', () => {
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: ORA-00907: missing right parenthesis\nerror occur at position: 2868',
        );
        expect(location).toMatchObject({
            kind: 'offset',
            offset: 2867,
            statementIndex: 1,
            rawToken: '2868',
        });
    });

    it('parses PostgreSQL LINE markers and SQL Server line/column pairs', () => {
        expect(parseSqlExecutionErrorLocation('ERROR: syntax error at or near "FROM"\nLINE 12: SELECT * FROM FROM users')).toMatchObject({
            kind: 'lineColumn',
            line: 12,
            column: 1,
            rawToken: '12',
        });
        expect(parseSqlExecutionErrorLocation('Incorrect syntax near \')\'.\nMsg 102, Level 15, State 1, Line 8, Column 14')).toMatchObject({
            kind: 'lineColumn',
            line: 8,
            column: 14,
            rawToken: '8',
        });
        expect(parseSqlExecutionErrorLocation('PROCEDURE DEMO, line 12, position 5: PLS-00103: Encountered the symbol "END"')).toMatchObject({
            kind: 'lineColumn',
            line: 12,
            column: 5,
            rawToken: '12',
        });
    });

    it('parses KingBase/Postgres at-or-near tokens when LINE is missing', () => {
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: kb: syntax error at or near "("',
        );
        expect(location).toMatchObject({
            kind: 'token',
            token: '(',
            statementIndex: 1,
            rawToken: '"("',
        });
        expect(parseSqlExecutionErrorLocation('pq: syntax error at or near "from"')).toMatchObject({
            kind: 'token',
            token: 'from',
            rawToken: '"from"',
        });
    });

    it('maps a wrapped Oracle SELECT position back into the editor fragment', () => {
        const originalSql = 'ABCDEFGHIJ';
        const sentSql = `XX${originalSql}`;
        const editorSql = `---${originalSql}`;
        const location = parseSqlExecutionErrorLocation('error occur at position: 4');
        expect(location?.offset).toBe(3);
        expect(mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(editorSql, originalSql, sentSql),
            editorSql,
        )).toBe(4);
        expect(offsetToMonacoPosition('ab\ncd', 4)).toEqual({ lineNumber: 2, column: 2 });
    });

    it('maps the failing statement offset when the editor contains a prefix and later statements', () => {
        const originalSql = 'SELECT * FROM t WHERE (id = 1';
        const sentSql = `XX${originalSql}`;
        const editorSql = `-- header\n${originalSql};\nSELECT 2`;
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: ORA-00907: missing right parenthesis\nerror occur at position: 4',
        );
        expect(mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(editorSql, editorSql, `${sentSql};\nSELECT 2`, [
                { originalSql, executedSql: sentSql },
                { originalSql: 'SELECT 2', executedSql: 'SELECT 2' },
            ]),
            editorSql,
        )).toBe(editorSql.indexOf(originalSql) + 1);
    });

    it('maps a KingBase missing-comma at-or-near "(" back to the unfinished select item', () => {
        const sql = [
            'WITH rfm AS (',
            '    SELECT c.id',
            '),',
            'scored AS (',
            '    SELECT name,',
            '           NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score1',
            '           NTILE(5) OVER (ORDER BY frequency) AS f_score,',
            '    FROM rfm',
            ')',
            'SELECT 1',
        ].join('\n');
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: kb: syntax error at or near "("',
        );
        const offset = mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(sql, sql, sql),
            sql,
        );
        const alias = 'r_score1';
        expect(offset).toBe(sql.indexOf(alias) + alias.length - 1);
        expect(sql.slice(offset!, offset! + 1)).toBe('1');
        const parts = splitSqlErrorLocationText(
            'kb: syntax error at or near "("',
            location,
        );
        expect(parts.some((part) => part.locate && part.text === '"("')).toBe(true);
    });

    it('maps a KingBase missing-comma at-or-near NTILE to the previous alias, not the first NTILE', () => {
        const sql = [
            'WITH rfm AS (',
            '    SELECT c.id',
            '),',
            'scored AS (',
            '    SELECT name, city, recency_days, frequency, monetary,',
            '           NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score',
            '           NTILE(5) OVER (ORDER BY frequency) AS f_score,',
            '           NTILE(5) OVER (ORDER BY monetary) AS m_score',
            '    FROM rfm',
            ')',
            'SELECT 1',
        ].join('\n');
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: kb: syntax error at or near "NTILE"',
        );
        const offset = mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(sql, sql, sql),
            sql,
        );
        const alias = 'r_score';
        expect(offset).toBe(sql.indexOf(alias) + alias.length - 1);
        expect(sql.slice(offset!, offset! + 1)).toBe('e');
        expect(offset).not.toBe(sql.indexOf('NTILE'));

        const setPosition = vi.fn();
        const setSelection = vi.fn();
        revealQueryEditorSqlErrorLocation({
            editor: {
                getModel: () => ({ getValue: () => sql }),
                setPosition,
                setSelection,
                revealPositionInCenterIfOutsideViewport: vi.fn(),
                focus: vi.fn(),
            },
            error: 'kb: syntax error at or near "NTILE"',
            origin: createQueryEditorExecutionOrigin(sql, sql, sql),
            currentSql: sql,
        });
        const position = offsetToMonacoPosition(sql, offset!);
        expect(setPosition).toHaveBeenCalledWith(position);
        expect(setSelection).toHaveBeenCalledWith({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column + 1,
        });
    });

    it('keeps at-or-near FROM on the FROM clause when the select list has no trailing comma', () => {
        const sql = 'SELECT id\nFROM unknown_table';
        const location = parseSqlExecutionErrorLocation('kb: syntax error at or near "FROM"');
        const offset = mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(sql, sql, sql),
            sql,
        );
        expect(offset).toBe(sql.indexOf('FROM'));
    });

    it('maps a KingBase extra comma before FROM back to that comma, not FROM', () => {
        const sql = [
            'WITH rfm AS (',
            '    SELECT c.id, c.name, c.city,',
            '           COALESCE(SUM(o.total_amount),0) AS monetary,',
            '    FROM lab_customers c',
            '    LEFT JOIN lab_orders o ON o.customer_id = c.id',
            '    GROUP BY c.id, c.name, c.city',
            '),',
            'scored AS (',
            '    SELECT name FROM rfm',
            ')',
            'SELECT 1',
        ].join('\n');
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: kb: syntax error at or near "FROM"',
        );
        const offset = mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(sql, sql, sql),
            sql,
        );
        expect(sql.slice(offset!, offset! + 1)).toBe(',');
        expect(offset).toBe(sql.indexOf('AS monetary,') + 'AS monetary,'.length - 1);
        expect(offset).not.toBe(sql.indexOf('FROM'));
    });

    it('keeps a mistyped FROM1 token on that word instead of the previous select item', () => {
        const sql = [
            'WITH rfm AS (',
            '    SELECT c.id, c.name, c.city,',
            '           COALESCE(SUM(o.total_amount),0) AS monetary',
            '    FROM1 lab_customers c',
            '    LEFT JOIN lab_orders o ON o.customer_id = c.id',
            '    GROUP BY c.id, c.name, c.city',
            '),',
            'scored AS (',
            '    SELECT name FROM rfm',
            ')',
            'SELECT 1',
        ].join('\n');
        const location = parseSqlExecutionErrorLocation(
            '第 1 条语句执行失败: kb: syntax error at or near "FROM1"',
        );
        const offset = mapSqlErrorLocationToOffset(
            location!,
            createQueryEditorExecutionOrigin(sql, sql, sql),
            sql,
        );
        expect(offset).toBe(sql.indexOf('FROM1'));
        expect(sql.slice(offset!, offset! + 5)).toBe('FROM1');
    });

    it('turns the reported position token into a locate target and reveals it in the editor', () => {
        const error = 'ORA-00907: missing right parenthesis\nerror occur at position: 9';
        const parts = splitSqlErrorLocationText(error, parseSqlExecutionErrorLocation(error));
        expect(parts.some((part) => part.locate && part.text === '9')).toBe(true);

        const setPosition = vi.fn();
        const setSelection = vi.fn();
        const reveal = vi.fn();
        const focus = vi.fn();
        const sql = 'SELECT (id FROM users';
        const revealed = revealQueryEditorSqlErrorLocation({
            editor: {
                getModel: () => ({ getValue: () => sql }),
                setPosition,
                setSelection,
                revealPositionInCenterIfOutsideViewport: reveal,
                focus,
            },
            error,
            origin: createQueryEditorExecutionOrigin(sql, sql, sql),
            currentSql: sql,
        });
        expect(revealed).toBe(true);
        expect(setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 9 });
        expect(setSelection).toHaveBeenCalledWith({
            startLineNumber: 1,
            startColumn: 9,
            endLineNumber: 1,
            endColumn: 10,
        });
        expect(reveal).toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
        expect(revealQueryEditorSqlErrorLocation({
            editor: { setPosition, focus },
            error: 'table not found',
            currentSql: sql,
        })).toBe(false);
    });
});

describe('resolveExecutionErrorStatementText', () => {
    const twoStatementSql = 'SELECT * FROM users;\nUPDATE orders SET amount = 1 WHERE;\nSELECT 1;';

    it('uses the per-statement origin entry when the error carries a statement index', () => {
        const origin = createQueryEditorExecutionOrigin(
            twoStatementSql,
            twoStatementSql,
            twoStatementSql,
            [
                { originalSql: 'SELECT * FROM users;' },
                { originalSql: 'UPDATE orders SET amount = 1 WHERE;' },
                { originalSql: 'SELECT 1;' },
            ],
        );
        expect(resolveExecutionErrorStatementText({
            error: '第 2 条语句执行失败: ERROR: syntax error at end of input',
            origin,
            currentEditorSql: twoStatementSql,
        })).toBe('UPDATE orders SET amount = 1 WHERE;');
    });

    it('falls back to the statement containing the mapped error offset', () => {
        expect(resolveExecutionErrorStatementText({
            error: 'ERROR: syntax error at or near ";"\nLINE 2: UPDATE orders SET amount = 1 WHERE;',
            origin: null,
            currentEditorSql: twoStatementSql,
            dbType: 'postgresql',
        })).toBe('UPDATE orders SET amount = 1 WHERE');
    });

    it('returns empty when the error has no parseable location', () => {
        expect(resolveExecutionErrorStatementText({
            error: 'connection refused',
            origin: null,
            currentEditorSql: twoStatementSql,
        })).toBe('');
    });

    it('compensates the selection start line for lineColumn errors (#1324)', () => {
        const filler = Array.from({ length: 29 }, (_, index) => `-- filler ${index + 1}`).join('\n');
        const fragment = 'SELECT a\nFROM t\nWHERE b = 1';
        const editorSql = `${filler}\n${fragment}`;
        const location = parseSqlExecutionErrorLocation('Msg 102, Level 15, State 1, Line 3, Column 7');
        const origin = createQueryEditorExecutionOrigin(
            editorSql,
            fragment,
            fragment,
            undefined,
            filler.length + 1,
        );
        const offset = mapSqlErrorLocationToOffset(location!, origin, editorSql);
        // 片段第 3 行 = 编辑器第 32 行，而非第 3 行
        expect(offsetToMonacoPosition(editorSql, offset!)).toEqual({ lineNumber: 32, column: 7 });
    });

    it('lands on the executed occurrence when the fragment text appears twice (#1324)', () => {
        const fragment = 'SELECT id\nFROM users\nWHERE id = 1';
        const editorSql = `${fragment}\n\n-- later\n${fragment}`;
        const secondStart = editorSql.lastIndexOf(fragment);
        const location = parseSqlExecutionErrorLocation('LINE 2: FROM users');
        const origin = createQueryEditorExecutionOrigin(
            editorSql,
            fragment,
            fragment,
            undefined,
            secondStart,
        );
        const offset = mapSqlErrorLocationToOffset(location!, origin, editorSql);
        // 第二处片段的第 2 行 = 编辑器第 7 行；indexOf 首次命中会错到第 2 行
        expect(offsetToMonacoPosition(editorSql, offset!)).toEqual({ lineNumber: 7, column: 1 });
    });

    it('ignores a stale recorded offset and falls back to the first occurrence (#1324)', () => {
        const fragment = 'SELECT id FROM users';
        const editorSql = `${fragment};\nSELECT 1;`;
        const location = parseSqlExecutionErrorLocation('LINE 1: SELECT id FROM users');
        const origin = createQueryEditorExecutionOrigin(
            editorSql,
            fragment,
            fragment,
            undefined,
            999,
        );
        const offset = mapSqlErrorLocationToOffset(location!, origin, editorSql);
        expect(offsetToMonacoPosition(editorSql, offset!)).toEqual({ lineNumber: 1, column: 1 });
    });

    it('keeps full-editor execution mapping unchanged without a recorded offset (#1324)', () => {
        const editorSql = 'SELECT 1\nFROM t';
        const location = parseSqlExecutionErrorLocation('LINE 2: FROM t');
        const origin = createQueryEditorExecutionOrigin(editorSql, editorSql, editorSql);
        const offset = mapSqlErrorLocationToOffset(location!, origin, editorSql);
        expect(offsetToMonacoPosition(editorSql, offset!)).toEqual({ lineNumber: 2, column: 1 });
    });
});
