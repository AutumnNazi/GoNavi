import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import {
    buildQueryEditorTableSuggestionLabel,
    mergeCompletionTableComments,
    normalizeQueryEditorTableSuggestionText,
    shouldAwaitLazyTablesForTableCompletion,
    shouldRefreshQueryEditorCompletionColumns,
} from './queryEditorCompletionPolicy';

describe('query editor completion policy', () => {
    it('does not wait for a table list that is already in memory', () => {
        expect(shouldAwaitLazyTablesForTableCompletion(true)).toBe(false);
        expect(shouldAwaitLazyTablesForTableCompletion(false)).toBe(true);
    });

    it('keeps FROM completion off the table-comment RPC once the current database already has tables', () => {
        const editorSource = readFileSync(new URL('../QueryEditor.tsx', import.meta.url), 'utf8');
        expect(editorSource).toContain('shouldAwaitLazyTablesForTableCompletion(');
        expect(editorSource).not.toContain('currentSharedTables.some((table) => !normalizeCommentText(table.comment))');
    });

    it('applies newly loaded table comments without rewriting unchanged rows', () => {
        const tables = [
            { tableName: 'users', comment: '' },
            { tableName: 'orders', comment: '订单' },
        ];
        const comments = new Map([
            ['users', '用户表'],
            ['orders', '订单'],
        ]);

        expect(mergeCompletionTableComments(tables, (table) => comments.get(table.tableName) || '')).toEqual([
            { tableName: 'users', comment: '用户表' },
            { tableName: 'orders', comment: '订单' },
        ]);
        expect(mergeCompletionTableComments(tables, (table) => table.comment || '')).toBe(tables);
    });

    it('only refreshes columns for column-name intent when metadata is missing or incomplete', () => {
        expect(shouldRefreshQueryEditorCompletionColumns('column_name', true, true)).toBe(true);
        expect(shouldRefreshQueryEditorCompletionColumns('column_name', true, false)).toBe(false);
        expect(shouldRefreshQueryEditorCompletionColumns('column_name', false, false)).toBe(true);
        expect(shouldRefreshQueryEditorCompletionColumns('table_name', false, true)).toBe(false);
    });

    it('strips newlines from suggestion labels and can keep a structured description', () => {
        expect(normalizeQueryEditorTableSuggestionText(' users \n')).toBe('users');
        expect(buildQueryEditorTableSuggestionLabel('users', 'table', true)).toEqual({
            label: 'users',
            description: 'table',
        });
        expect(buildQueryEditorTableSuggestionLabel('users', 'table', false)).toBe('users');
    });
});
