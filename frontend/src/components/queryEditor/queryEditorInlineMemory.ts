// 查询编辑器本地 SQL 记忆（inline completion 候选构建）与剪贴板辅助：
// 从超标的 QueryEditor.tsx 迁出的模块级纯函数，行为不变。

import type { SavedQuery } from '../../types';
import type { SqlLog } from '../../store';

export const normalizeQueryEditorInlineMemorySqlKey = (sql: string): string => (
    String(sql || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
);

export const normalizeQueryEditorCompletionAnalysisText = (sql: string): string => {
    const normalized = String(sql || '').replace(/\r\n?/g, '\n');
    // Preserve offsets while preventing a UTF-8 BOM from becoming part of SQL syntax analysis.
    return normalized.startsWith('\uFEFF') ? ` ${normalized.slice(1)}` : normalized;
};

export const matchesQueryEditorInlineMemoryDb = (currentDb: string, candidateDb?: string): boolean => {
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

const CLIPBOARD_WRITE_TIMEOUT_MS = 2000;

export const copyQueryEditorTextToClipboard = async (text: string): Promise<boolean> => {
    const tryAsyncClipboardWrite = async (): Promise<boolean> => {
        if (typeof navigator?.clipboard?.writeText !== 'function') {
            return false;
        }

        try {
            const written = await Promise.race([
                navigator.clipboard.writeText(text).then(() => true as const),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), CLIPBOARD_WRITE_TIMEOUT_MS)),
            ]);
            return written;
        } catch {
            return false;
        }
    };

    if (typeof document?.createElement === 'function' && typeof document?.execCommand === 'function') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.setAttribute('aria-hidden', 'true');
        Object.assign(textarea.style, {
            position: 'fixed',
            top: '0',
            left: '-9999px',
            opacity: '0',
            pointerEvents: 'none',
        });

        try {
            document.body?.appendChild?.(textarea);
            textarea.focus?.();
            textarea.select?.();
            textarea.setSelectionRange?.(0, text.length);
            if (document.execCommand('copy')) {
                return true;
            }
        } catch {
            // Fall through to async clipboard APIs when execCommand is unavailable.
        } finally {
            textarea.remove?.();
        }
    }

    if (await tryAsyncClipboardWrite()) {
        return true;
    }
    return false;
};
