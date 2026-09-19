import { describe, expect, it } from 'vitest';

import {
    buildBoundedQueryEditorCompletionSuggestions,
    rankQueryEditorCompletionCandidate,
} from './QueryEditorHelpers';

describe('QueryEditor completion fuzzy matching', () => {
    it('keeps table names for ordered character matches', () => {
        expect(rankQueryEditorCompletionCandidate('abcd', ['abc_def'])).toBe(3);
        expect(rankQueryEditorCompletionCandidate('adg', ['abc_def_gh'])).toBe(3);
        expect(rankQueryEditorCompletionCandidate('ocdi', ['ot_clod_info'])).toBe(3);
        expect(rankQueryEditorCompletionCandidate('hrmres', ['hrm_resource_export_template'])).toBe(3);

        const suggestions = buildBoundedQueryEditorCompletionSuggestions({
            candidates: ['other_table', 'abc_def'],
            prefix: 'abcd',
            getMatchRank: (candidate, prefix) => rankQueryEditorCompletionCandidate(prefix, [candidate]),
            getSelectionKey: (candidate, _prefix, rank) => `${rank}${candidate}`,
            buildSuggestion: (candidate) => candidate,
        });

        expect(suggestions).toEqual(['abc_def']);
    });

    it('keeps strict matching when fuzzy matching is disabled', () => {
        expect(rankQueryEditorCompletionCandidate('abcd', ['abc_def'], false)).toBeNull();
    });
});
