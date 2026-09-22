import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { QueryEditorResultSet, QueryEditorResultViewState } from '../QueryEditorResultsPanel';
import { setQueryEditorPendingResultChanges } from './queryEditorPendingResultChanges';

export const useQueryEditorResultViewState = ({
  tabId,
  resultSets,
  resultSetsRef,
  setResultSets,
}: {
  tabId: string;
  resultSets: QueryEditorResultSet[];
  resultSetsRef: MutableRefObject<QueryEditorResultSet[]>;
  setResultSets: Dispatch<SetStateAction<QueryEditorResultSet[]>>;
}) => {
  const hasPendingChanges = resultSets.some((result) => result.hasPendingChanges === true);
  useEffect(() => {
    setQueryEditorPendingResultChanges(tabId, hasPendingChanges);
  }, [hasPendingChanges, tabId]);

  useEffect(() => (
    () => setQueryEditorPendingResultChanges(tabId, false)
  ), [tabId]);

  return useCallback((key: string, patch: Partial<QueryEditorResultViewState>) => {
    let changed = false;
    const nextResultSets = resultSetsRef.current.map((result) => {
      if (result.key !== key) return result;
      const patchEntries = Object.entries(patch) as Array<[
        keyof QueryEditorResultViewState,
        QueryEditorResultViewState[keyof QueryEditorResultViewState],
      ]>;
      if (patchEntries.every(([field, value]) => Object.is(result[field], value))) return result;
      changed = true;
      return { ...result, ...patch };
    });
    if (!changed) return;
    resultSetsRef.current = nextResultSets;
    if (Object.prototype.hasOwnProperty.call(patch, 'hasPendingChanges')) {
      setQueryEditorPendingResultChanges(
        tabId,
        nextResultSets.some((result) => result.hasPendingChanges === true),
      );
    }
    setResultSets(nextResultSets);
  }, [resultSetsRef, setResultSets, tabId]);
};
