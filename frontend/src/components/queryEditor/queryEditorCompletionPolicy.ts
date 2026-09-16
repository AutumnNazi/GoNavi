export const shouldRefreshQueryEditorCompletionColumns = (
    intent: string,
    hasColumnsForDatabase: boolean,
    hasIncompleteColumnMetadata: boolean,
): boolean => (
    intent === 'column_name' && (hasIncompleteColumnMetadata || !hasColumnsForDatabase)
);

export const shouldAwaitLazyTablesForTableCompletion = (
    hasCurrentDatabaseTables: boolean,
): boolean => !hasCurrentDatabaseTables;

export const mergeCompletionTableComments = <T extends { comment?: string }>(
    tables: readonly T[],
    resolveComment: (table: T) => string,
): T[] => {
    let changed = false;
    const next = tables.map((table) => {
        const comment = String(resolveComment(table) || '').trim();
        if (!comment || comment === table.comment) {
            return table;
        }
        changed = true;
        return { ...table, comment };
    });
    return changed ? next : tables as T[];
};

export const normalizeQueryEditorTableSuggestionText = (value: unknown): string => (
    String(value ?? '').replace(/\r\n|\r|\n/g, '').trim()
);

export const buildQueryEditorTableSuggestionLabel = (
    label: unknown,
    description?: unknown,
    useStructuredLabel = true,
): string | { label: string; description: string } => {
    const normalizedLabel = normalizeQueryEditorTableSuggestionText(label);
    const normalizedDescription = normalizeQueryEditorTableSuggestionText(description);
    if (!useStructuredLabel) {
        return normalizedLabel;
    }
    return {
        label: normalizedLabel,
        description: normalizedDescription,
    };
};
