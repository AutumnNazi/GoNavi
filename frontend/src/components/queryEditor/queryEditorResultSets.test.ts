import { describe, expect, it } from 'vitest';

import { GONAVI_ROW_KEY } from '../DataGridCore';
import {
    filterQueryEditorResultSetsForBulkClose,
    parseQueryResultSortInfo,
    sortCompleteQueryResultRows,
} from './queryEditorResultSets';

describe('query editor result sets', () => {
    it('parses multi-column sort payloads and falls back to the legacy single column shape', () => {
        expect(parseQueryResultSortInfo(JSON.stringify([
            { columnKey: 'id', order: 'ascend' },
            { columnKey: 'name', order: 'descend' },
            { columnKey: 'id', order: 'descend' },
        ]), 'descend')).toEqual([
            { columnKey: 'id', order: 'ascend', enabled: true },
            { columnKey: 'name', order: 'descend', enabled: true },
        ]);
        expect(parseQueryResultSortInfo('age', 'descend')).toEqual([
            { columnKey: 'age', order: 'descend', enabled: true },
        ]);
    });

    it('sorts complete result rows and keeps the original order as a stable tie-breaker', () => {
        const rows = [
            { name: 'b', [GONAVI_ROW_KEY]: 2 },
            { name: 'a', [GONAVI_ROW_KEY]: 1 },
            { name: 'a', [GONAVI_ROW_KEY]: 0 },
        ];
        expect(sortCompleteQueryResultRows(rows, [{ columnKey: 'name', order: 'ascend', enabled: true }]).map((row) => row[GONAVI_ROW_KEY])).toEqual([0, 1, 2]);
    });

    it('keeps pinned result tabs when bulk-closing around a target', () => {
        const resultSets = [
            { key: 'result-1' },
            { key: 'result-2', pinned: true },
            { key: 'result-3' },
        ];
        expect(filterQueryEditorResultSetsForBulkClose(resultSets, 'result-2', 'other').map((result) => result.key)).toEqual(['result-2']);
        expect(filterQueryEditorResultSetsForBulkClose(resultSets, 'result-2', 'left').map((result) => result.key)).toEqual(['result-2', 'result-3']);
        expect(filterQueryEditorResultSetsForBulkClose(resultSets, 'result-2', 'right').map((result) => result.key)).toEqual(['result-1', 'result-2']);
        expect(filterQueryEditorResultSetsForBulkClose(resultSets, '', 'all').map((result) => result.key)).toEqual(['result-2']);
    });
});
