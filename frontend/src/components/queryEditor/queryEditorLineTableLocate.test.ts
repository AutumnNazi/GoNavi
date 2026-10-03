import { describe, expect, it } from 'vitest';

import { resolveQueryEditorLineTableLocate } from './queryEditorLineTableLocate';

describe('query editor line table locate', () => {
    const resolveTarget = (reference: { tableIdent: string }) => ({
        type: 'table' as const,
        dbName: 'main',
        tableName: reference.tableIdent,
    });

    it('locates a table from the current SQL line and cycles across multiple references', () => {
        const input = {
            lineContent: 'SELECT * FROM users JOIN orders ON users.id = orders.user_id',
            lineNumber: 2,
            dialect: 'mysql',
            resolveTarget,
        };
        const first = resolveQueryEditorLineTableLocate({ ...input, previous: null });
        expect(first?.target.tableName).toBe('users');
        const second = resolveQueryEditorLineTableLocate({ ...input, previous: first!.cycle });
        expect(second?.target.tableName).toBe('orders');
        expect(resolveQueryEditorLineTableLocate({ ...input, previous: second!.cycle })?.target.tableName).toBe('users');
    });

    it('returns no target when the cursor is on a blank line', () => {
        expect(resolveQueryEditorLineTableLocate({
            lineContent: '  ', lineNumber: 3, dialect: 'mysql', previous: null, resolveTarget,
        })).toBeNull();
    });
});
