import { maskQueryEditorSqlLiteralsAndComments } from './QueryEditorHelpers';

export const hasElasticsearchUncertainOutcome = (response: { outcomeUnknown?: unknown } | null | undefined): boolean => (
    response?.outcomeUnknown === true
);

export const hasSqlExecutionOutcomeUnknown = (response: {
    success?: unknown;
    outcomeUnknown?: unknown;
    cancellationState?: unknown;
    data?: { outcomeUnknown?: unknown; cancellationState?: unknown };
} | null | undefined): boolean => (
    !response
    || typeof response?.success !== 'boolean'
    || response?.outcomeUnknown === true
    || response?.data?.outcomeUnknown === true
    || String(response?.cancellationState || '').trim().toLowerCase() === 'unsupported'
    || String(response?.data?.cancellationState || '').trim().toLowerCase() === 'unsupported'
);

export const isQueryEditorTriggerDropStatement = (statement: string): boolean => (
    /^\s*DROP\s+TRIGGER\b/i.test(maskQueryEditorSqlLiteralsAndComments(String(statement || '')))
);

export const buildElasticsearchOutcomeMetadata = (
    response: { outcomeUnknown?: unknown } | null | undefined,
): { outcomeUnknown: boolean } => ({
    outcomeUnknown: hasElasticsearchUncertainOutcome(response),
});
