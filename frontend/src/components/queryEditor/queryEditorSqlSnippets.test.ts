import { describe, expect, it, vi } from 'vitest';

import { materializeSqlSnippetText } from './queryEditorSqlSnippets';

describe('query editor sql snippets', () => {
    it('materializes tabstops, choices, and date variables', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const text = materializeSqlSnippetText(
            'SELECT ${1:id}, ${2|name,title|} FROM t WHERE y=${CURRENT_YEAR} $1$0 leftover',
            new Date('2026-09-16T08:00:00'),
        );
        expect(text).toBe('SELECT id, name FROM t WHERE y=2026 id leftover');
    });

    it('keeps unknown snippet variables untouched', () => {
        expect(materializeSqlSnippetText('SELECT ${UNKNOWN}', new Date('2026-01-01'))).toBe('SELECT ${UNKNOWN}');
    });
});
