import { describe, expect, it } from 'vitest';

import { buildQueryEditorInlineMemoryEntries } from './queryEditorInlineMemory';
import type { SavedQuery } from '../../types';
import type { SqlLog } from '../../store';

const query = (overrides: Partial<SavedQuery>): SavedQuery => ({
    id: 'q1',
    name: 'saved',
    sql: 'SELECT 1',
    connectionId: 'conn-a',
    dbName: 'main',
    createdAt: 10,
    ...overrides,
});

const log = (overrides: Partial<SqlLog>): SqlLog => ({
    id: 'l1',
    timestamp: 20,
    sql: 'SELECT 1',
    status: 'success',
    duration: 1,
    dbName: 'main',
    ...overrides,
});

describe('query editor inline memory', () => {
    it('ranks saved queries above successful logs and dedupes normalized SQL', () => {
        const entries = buildQueryEditorInlineMemoryEntries({
            currentConnectionId: 'conn-a',
            currentDb: 'main',
            savedQueries: [
                query({ sql: 'select   1', createdAt: 5 }),
                query({ connectionId: 'conn-b', sql: 'SELECT 2' }),
            ],
            sqlLogs: [
                log({ sql: 'SELECT 1', timestamp: 50 }),
                log({ sql: 'SELECT 3', timestamp: 40 }),
                log({ sql: 'SELECT 4', status: 'error' }),
                log({ sql: 'COMMIT', category: 'transaction' }),
            ],
        });
        expect(entries.map((entry) => entry.sql)).toEqual(['SELECT 1', 'SELECT 3']);
    });
});
