import React, { useRef, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import type { QueryEditorResultSet } from '../QueryEditorResultsPanel';
import {
  hasQueryEditorPendingResultChanges,
  setQueryEditorPendingResultChanges,
} from './queryEditorPendingResultChanges';
import { useQueryEditorResultViewState } from './useQueryEditorResultViewState';

describe('useQueryEditorResultViewState', () => {
  afterEach(() => setQueryEditorPendingResultChanges('query-1', false));

  it('publishes pending grid edits and clears the tab registry on unmount', () => {
    let updateViewState!: ReturnType<typeof useQueryEditorResultViewState>;
    let latestResults: QueryEditorResultSet[] = [];

    const Harness = () => {
      const [resultSets, setResultSets] = useState<QueryEditorResultSet[]>([{
        key: 'result-1',
        sql: 'select id from users',
        rows: [{ id: 1 }],
        columns: ['id'],
        pkColumns: ['id'],
        readOnly: false,
      }]);
      const resultSetsRef = useRef(resultSets);
      resultSetsRef.current = resultSets;
      latestResults = resultSets;
      updateViewState = useQueryEditorResultViewState({
        tabId: 'query-1',
        resultSets,
        resultSetsRef,
        setResultSets,
      });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });
    expect(hasQueryEditorPendingResultChanges('query-1')).toBe(false);

    act(() => updateViewState('result-1', { hasPendingChanges: true }));
    expect(latestResults[0].hasPendingChanges).toBe(true);
    expect(hasQueryEditorPendingResultChanges('query-1')).toBe(true);

    act(() => renderer.unmount());
    expect(hasQueryEditorPendingResultChanges('query-1')).toBe(false);
  });
});
