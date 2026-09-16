import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { QueryEditorResultSet } from '../QueryEditorResultsPanel';
import { applyQueryEditorResultHistoryBudget } from './queryEditorResultHistory';

export const useQueryEditorResultHistoryBudget = ({
  resultSets,
  protectedActiveKey,
  resultSetsRef,
  setResultSets,
  onTrimmed,
}: {
  resultSets: QueryEditorResultSet[];
  protectedActiveKey: string;
  resultSetsRef: MutableRefObject<QueryEditorResultSet[]>;
  setResultSets: Dispatch<SetStateAction<QueryEditorResultSet[]>>;
  onTrimmed: () => void;
}): void => {
  const previousInputsRef = useRef<QueryEditorResultSet[]>([]);
  const previousActiveKeyRef = useRef('');

  useEffect(() => {
    const previousInputs = previousInputsRef.current;
    const budgetInputsChanged = previousInputs.length !== resultSets.length
      || resultSets.some((result, index) => {
        const previous = previousInputs[index];
        return !previous
          || previous.key !== result.key
          || !Object.is(previous.rows, result.rows)
          || !Object.is(previous.columns, result.columns)
          || !Object.is(previous.messages, result.messages)
          || previous.rawResponse !== result.rawResponse
          || previous.sql !== result.sql
          || previous.pinned !== result.pinned
          || previous.hasPendingChanges !== result.hasPendingChanges
          || !Object.is(previous.filterConditions, result.filterConditions)
          || previous.quickWhereCondition !== result.quickWhereCondition
          || !Object.is(previous.selectedRowKeys, result.selectedRowKeys)
          || !Object.is(previous.selectedCellKeys, result.selectedCellKeys);
      });
    if (!budgetInputsChanged && previousActiveKeyRef.current === protectedActiveKey) return;
    previousInputsRef.current = resultSets;
    previousActiveKeyRef.current = protectedActiveKey;

    const budgeted = applyQueryEditorResultHistoryBudget(
      resultSets,
      protectedActiveKey ? [protectedActiveKey] : [],
    );
    if (budgeted.evictedKeys.length === 0) return;
    previousInputsRef.current = budgeted.resultSets;
    resultSetsRef.current = budgeted.resultSets;
    setResultSets(budgeted.resultSets);
    onTrimmed();
  }, [onTrimmed, protectedActiveKey, resultSets, resultSetsRef, setResultSets]);
};
