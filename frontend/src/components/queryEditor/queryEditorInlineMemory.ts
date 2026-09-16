import type { SavedQuery } from '../../types';
import type { SqlLog } from '../../store';

const normalizeQueryEditorInlineMemorySqlKey = (sql: string): string => (
    String(sql || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
);

const matchesQueryEditorInlineMemoryDb = (currentDb: string, candidateDb?: string): boolean => {
    const normalizedCurrentDb = String(currentDb || '').trim().toLowerCase();
    const normalizedCandidateDb = String(candidateDb || '').trim().toLowerCase();
    if (!normalizedCurrentDb || !normalizedCandidateDb) {
        return true;
    }
    return normalizedCurrentDb === normalizedCandidateDb;
};

export const buildQueryEditorInlineMemoryEntries = ({
    currentConnectionId,
    currentDb,
    savedQueries,
    sqlLogs,
}: {
    currentConnectionId: string;
    currentDb: string;
    savedQueries: SavedQuery[];
    sqlLogs: SqlLog[];
}): Array<{ sql: string }> => {
    const ranked = new Map<string, { sql: string; score: number; latestAt: number }>();
    const addCandidate = (sql: string, score: number, latestAt: number) => {
        const text = String(sql || '').trim();
        if (!text) {
            return;
        }
        const key = normalizeQueryEditorInlineMemorySqlKey(text);
        if (!key) {
            return;
        }
        const existing = ranked.get(key);
        if (!existing) {
            ranked.set(key, { sql: text, score, latestAt });
            return;
        }
        existing.score += score;
        if (latestAt >= existing.latestAt) {
            existing.latestAt = latestAt;
            existing.sql = text;
        }
    };

    savedQueries.forEach((query) => {
        if (currentConnectionId && String(query.connectionId || '').trim() !== currentConnectionId) {
            return;
        }
        if (!matchesQueryEditorInlineMemoryDb(currentDb, query.dbName)) {
            return;
        }
        addCandidate(query.sql, 600, Number(query.createdAt || 0));
    });

    sqlLogs.forEach((log) => {
        if (log.status !== 'success' || log.category === 'transaction') {
            return;
        }
        if (!matchesQueryEditorInlineMemoryDb(currentDb, log.dbName)) {
            return;
        }
        addCandidate(log.sql, 80, Number(log.timestamp || 0));
    });

    return [...ranked.values()]
        .sort((left, right) => (
            right.score - left.score
            || right.latestAt - left.latestAt
            || left.sql.length - right.sql.length
        ))
        .slice(0, 16)
        .map((entry) => ({ sql: entry.sql }));
};
