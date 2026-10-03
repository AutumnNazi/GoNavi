import {
    collectQueryEditorTableReferences,
    dispatchQueryEditorSidebarLocate,
    resolveNextQueryEditorTableLocateIndex,
    type QueryEditorNavigationTarget,
    type QueryEditorTableReference,
} from './QueryEditorHelpers';

type TableTarget = Extract<QueryEditorNavigationTarget, { type: 'table' }>;
type LocateCycle = { lineNumber: number; signature: string; index: number };

export const dispatchSavedQueryLocateFallback = (request: Record<string, unknown> | undefined): boolean => {
    if (!request || !String(request.savedQueryId || '').trim()) return false;
    dispatchQueryEditorSidebarLocate(request);
    return true;
};

export const resolveQueryEditorLineTableLocate = ({
    lineContent, lineNumber, dialect, previous, resolveTarget,
}: {
    lineContent: string;
    lineNumber: number;
    dialect: string;
    previous: LocateCycle | null;
    resolveTarget: (reference: QueryEditorTableReference) => QueryEditorNavigationTarget | null;
}): { target: TableTarget; cycle: LocateCycle } | null => {
    const targets = collectQueryEditorTableReferences(lineContent, dialect)
        .map(resolveTarget)
        .filter((target): target is TableTarget => target?.type === 'table');
    if (targets.length === 0) return null;
    const signature = targets.map((target) => `${target.dbName}\u0000${target.schemaName || ''}\u0000${target.tableName}`).join('\u0001');
    const index = resolveNextQueryEditorTableLocateIndex(previous, lineNumber, signature, targets.length);
    return { target: targets[index], cycle: { lineNumber, signature, index } };
};
