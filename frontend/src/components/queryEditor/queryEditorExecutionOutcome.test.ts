import { describe, expect, it } from 'vitest';

import {
    buildElasticsearchOutcomeMetadata,
    hasElasticsearchUncertainOutcome,
    hasSqlExecutionOutcomeUnknown,
    isQueryEditorTriggerDropStatement,
} from './queryEditorExecutionOutcome';

describe('query editor execution outcome', () => {
    it('marks elasticsearch responses with an unknown outcome flag', () => {
        expect(hasElasticsearchUncertainOutcome({ outcomeUnknown: true })).toBe(true);
        expect(hasElasticsearchUncertainOutcome({ outcomeUnknown: false })).toBe(false);
        expect(buildElasticsearchOutcomeMetadata({ outcomeUnknown: true })).toEqual({ outcomeUnknown: true });
    });

    it('treats missing success flags and unsupported cancellation as unknown SQL outcomes', () => {
        expect(hasSqlExecutionOutcomeUnknown(null)).toBe(true);
        expect(hasSqlExecutionOutcomeUnknown({ success: true })).toBe(false);
        expect(hasSqlExecutionOutcomeUnknown({ success: true, cancellationState: 'unsupported' })).toBe(true);
        expect(hasSqlExecutionOutcomeUnknown({ success: true, data: { outcomeUnknown: true } })).toBe(true);
    });

    it('detects DROP TRIGGER outside comments and string literals', () => {
        expect(isQueryEditorTriggerDropStatement('DROP TRIGGER users_audit')).toBe(true);
        expect(isQueryEditorTriggerDropStatement("SELECT 'DROP TRIGGER users_audit'")).toBe(false);
        expect(isQueryEditorTriggerDropStatement('-- DROP TRIGGER users_audit\nSELECT 1')).toBe(false);
    });
});
