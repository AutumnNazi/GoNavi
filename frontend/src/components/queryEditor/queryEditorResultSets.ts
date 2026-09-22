import { GONAVI_ROW_KEY } from '../DataGridCore';
import type { GridSortInfoItem } from '../../utils/dataGridSort';
import type { QueryEditorResultSet } from '../QueryEditorResultsPanel';
import { buildQueryEditorResultSetMergeKey, resolveNextResultSetIndex } from './QueryEditorHelpers';
import { applyQueryEditorResultHistoryBudget } from './queryEditorResultHistory';

export type QueryEditorBulkCloseMode = 'other' | 'left' | 'right' | 'all';

export const parseQueryResultSortInfo = (field: string, order: string): GridSortInfoItem[] => {
    let candidates: unknown[] = [];
    try {
        const parsed = JSON.parse(field);
        if (Array.isArray(parsed)) candidates = parsed;
    } catch {
        // Compatibility with the legacy single-column callback shape.
    }
    if (candidates.length === 0) {
        candidates = [{ columnKey: field, order, enabled: true }];
    }

    const normalized: GridSortInfoItem[] = [];
    const seen = new Set<string>();
    candidates.forEach((candidate) => {
        if (!candidate || typeof candidate !== 'object') return;
        const item = candidate as Record<string, unknown>;
        const columnKey = String(item.columnKey || '').trim();
        const normalizedOrder = item.order === 'ascend' || item.order === 'descend'
            ? item.order
            : '';
        const dedupeKey = columnKey.toLowerCase();
        if (!columnKey || !normalizedOrder || seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        normalized.push({
            columnKey,
            order: normalizedOrder,
            enabled: item.enabled !== false,
        });
    });
    return normalized;
};

const compareQueryResultValues = (left: unknown, right: unknown): number => {
    if (Object.is(left, right)) return 0;
    if (left === null || left === undefined) return -1;
    if (right === null || right === undefined) return 1;
    if (typeof left === 'bigint' && typeof right === 'bigint') {
        return left < right ? -1 : 1;
    }
    if (typeof left === 'number' && typeof right === 'number') {
        if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : -1;
        if (Number.isNaN(right)) return 1;
        return left < right ? -1 : left > right ? 1 : 0;
    }
    if (typeof left === 'boolean' && typeof right === 'boolean') {
        return Number(left) - Number(right);
    }
    return String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: 'base',
    });
};

const compareQueryResultOriginalOrder = (
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    leftIndex: number,
    rightIndex: number,
): number => {
    const leftKey = left?.[GONAVI_ROW_KEY];
    const rightKey = right?.[GONAVI_ROW_KEY];
    const leftNumber = Number(leftKey);
    const rightNumber = Number(rightKey);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }
    const keyOrder = String(leftKey ?? '').localeCompare(String(rightKey ?? ''), undefined, { numeric: true });
    return keyOrder || leftIndex - rightIndex;
};

export const sortCompleteQueryResultRows = <T extends Record<string, unknown>>(
    rows: T[],
    sortInfo: GridSortInfoItem[],
): T[] => {
    const activeSortInfo = sortInfo.filter((item) => item.enabled !== false);
    return rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
            for (const item of activeSortInfo) {
                const valueOrder = compareQueryResultValues(
                    left.row?.[item.columnKey],
                    right.row?.[item.columnKey],
                );
                if (valueOrder !== 0) {
                    return item.order === 'descend' ? -valueOrder : valueOrder;
                }
            }
            return compareQueryResultOriginalOrder(left.row, right.row, left.index, right.index);
        })
        .map(({ row }) => row);
};

export const filterQueryEditorResultSetsForBulkClose = <T extends { key: string; pinned?: boolean }>(
    resultSets: T[],
    key: string,
    mode: QueryEditorBulkCloseMode,
): T[] => {
    const targetIndex = resultSets.findIndex((result) => result.key === key);
    if (mode !== 'all' && targetIndex < 0) return resultSets;
    return resultSets.filter((result, index) => {
        if (result.pinned) return true;
        if (mode === 'all') return false;
        if (mode === 'other') return result.key === key;
        if (mode === 'left') return index >= targetIndex;
        return index <= targetIndex;
    });
};

const isAffectedRowsResult = (result?: QueryEditorResultSet | null): boolean => Boolean(
    result
    && result.columns.length === 1
    && result.columns[0] === 'affectedRows',
);

const isDisplayableResult = (result?: QueryEditorResultSet | null): boolean => Boolean(
    result
    && (
        (Array.isArray(result.messages) && result.messages.length > 0)
        || (Array.isArray(result.columns) && result.columns.length > 0)
        || (Array.isArray(result.rows) && result.rows.length > 0)
    ),
);

const resolvePreferredExecutedResultIndex = (
    executed: QueryEditorResultSet[],
): number => {
    const index = executed.findIndex((result) => (
        result.resultType !== 'message'
        && !isAffectedRowsResult(result)
        && (result.columns.length > 0 || result.rows.length > 0)
    ));
    if (index >= 0) return index;
    const messageIndex = executed.findIndex((result) => (
        result.messages && result.messages.length > 0 && result.resultType !== 'grid'
    ));
    if (messageIndex >= 0) return messageIndex;
    const nonAffectedIndex = executed.findIndex((result) => (
        isDisplayableResult(result) && !isAffectedRowsResult(result)
    ));
    if (nonAffectedIndex >= 0) return nonAffectedIndex;
    const displayableIndex = executed.findIndex(isDisplayableResult);
    return displayableIndex >= 0 ? displayableIndex : (executed.length > 0 ? 0 : -1);
};

export const mergeQueryEditorResultSets = (
    previous: QueryEditorResultSet[],
    next: QueryEditorResultSet[],
    replaceAll: boolean,
): { resultSets: QueryEditorResultSet[]; activeResultKey: string; evictedKeys: string[] } => {
    const merged = replaceAll
        ? previous.filter((result) => result.pinned || result.hasPendingChanges)
        : [...previous];
    const executedResultKeys: string[] = [];
    next.forEach((result) => {
        const incomingKey = buildQueryEditorResultSetMergeKey(result);
        const existingIndex = merged.findIndex((item) => (
            !item.pinned
            && !item.hasPendingChanges
            && buildQueryEditorResultSetMergeKey(item) === incomingKey
        ));
        if (existingIndex >= 0) {
            const existingKey = merged[existingIndex].key;
            merged[existingIndex] = { ...result, key: existingKey, pinned: false };
            executedResultKeys.push(existingKey);
            return;
        }
        const nextKey = `result-${resolveNextResultSetIndex(merged)}`;
        merged.push({ ...result, key: nextKey, pinned: false });
        executedResultKeys.push(nextKey);
    });
    const preferredExecutedIndex = resolvePreferredExecutedResultIndex(next);
    const activeResultKey = preferredExecutedIndex >= 0
        ? executedResultKeys[preferredExecutedIndex] || merged[0]?.key || ''
        : '';
    const budgeted = applyQueryEditorResultHistoryBudget(merged, activeResultKey ? [activeResultKey] : []);
    return {
        resultSets: budgeted.resultSets,
        activeResultKey,
        evictedKeys: budgeted.evictedKeys,
    };
};
