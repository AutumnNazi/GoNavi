import { describe, expect, it } from 'vitest';

import { QUERY_EDITOR_SQL_PROMPT_PLACEHOLDER, buildQueryEditorAiContextPrompt, resolveQueryEditorAiConnectionHost } from './queryEditorAiPrompt';

describe('query editor AI prompt helpers', () => {
    it('keeps the shared SQL placeholder token', () => {
        expect(QUERY_EDITOR_SQL_PROMPT_PLACEHOLDER).toBe('{SQL}');
    });

    it('builds a context prompt and prefers listed hosts', () => {
        expect(buildQueryEditorAiContextPrompt({
            name: 'prod',
            config: { type: 'mysql' },
        }, 'app')).toContain('prod');
        expect(resolveQueryEditorAiConnectionHost({
            config: { hosts: [{ host: 'db-a' }, { hostname: 'db-b' }], host: 'ignored' },
        })).toBe('db-a, db-b');
        expect(resolveQueryEditorAiConnectionHost({
            config: { host: '127.0.0.1' },
        })).toBe('127.0.0.1');
    });
});
