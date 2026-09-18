export const QUERY_EDITOR_COMPLETION_SUGGESTION_LIMIT = 200;

export type QueryEditorCompletionMatchRank = 0 | 1 | 2 | 3 | null;

const isOrderedCharacterMatch = (query: string, candidate: string): boolean => {
    let queryIndex = 0;
    for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < query.length; candidateIndex += 1) {
        if (candidate[candidateIndex] === query[queryIndex]) queryIndex += 1;
    }
    return queryIndex === query.length;
};

export const rankQueryEditorCompletionCandidate = (
    prefix: string,
    candidates: readonly string[],
    includeSubstring = true,
): QueryEditorCompletionMatchRank => {
    const normalizedPrefix = String(prefix || '').trim().toLowerCase();
    if (!normalizedPrefix) return 0;

    let hasPrefixMatch = false;
    let hasSubstringMatch = false;
    let hasFuzzyMatch = false;
    for (const candidate of candidates) {
        const normalizedCandidate = String(candidate || '').trim().toLowerCase();
        if (!normalizedCandidate) continue;
        if (normalizedCandidate === normalizedPrefix) return 0;
        if (normalizedCandidate.startsWith(normalizedPrefix)) {
            hasPrefixMatch = true;
        } else if (includeSubstring && normalizedCandidate.includes(normalizedPrefix)) {
            hasSubstringMatch = true;
        } else if (includeSubstring && isOrderedCharacterMatch(normalizedPrefix, normalizedCandidate)) {
            hasFuzzyMatch = true;
        }
    }
    if (hasPrefixMatch) return 1;
    if (hasSubstringMatch) return 2;
    if (hasFuzzyMatch) return 3;
    return null;
};

/**
 * Monaco applies its own fuzzy filter after the provider returns. When a
 * candidate is matched only by a substring, expose the matching suffix so
 * Monaco can keep the item visible even when the match does not start at a
 * word boundary (for example `title` in `subtitle`).
 */
export const resolveQueryEditorCompletionFilterText = (
    prefix: string,
    candidates: readonly string[],
): string | undefined => {
    const normalizedPrefix = String(prefix || '').trim().toLowerCase();
    if (!normalizedPrefix) return undefined;
    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        const matchIndex = value.toLowerCase().indexOf(normalizedPrefix);
        if (matchIndex >= 0) return value.slice(matchIndex);
    }
    return undefined;
};
