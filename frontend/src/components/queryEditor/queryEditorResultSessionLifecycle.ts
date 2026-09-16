import { useEffect, type MutableRefObject } from 'react';

import { useStore } from '../../store';
import {
  saveQueryEditorResultSessionForOpenTab,
  type QueryEditorResultSessionSnapshot,
} from '../../utils/queryEditorResultSessionCache';

type QueryEditorResultSessionRefs = {
  resultSetsRef: MutableRefObject<QueryEditorResultSessionSnapshot['resultSets']>;
  activeResultKeyRef: MutableRefObject<string>;
  isResultPanelVisibleRef: MutableRefObject<boolean>;
};

export const useQueryEditorResultSessionUnmount = ({
  tabId,
  resultSetsRef,
  activeResultKeyRef,
  isResultPanelVisibleRef,
}: QueryEditorResultSessionRefs & { tabId: string }): void => {
  useEffect(() => () => {
    saveQueryEditorResultSessionForOpenTab(tabId, {
      resultSets: resultSetsRef.current,
      activeResultKey: activeResultKeyRef.current,
      isResultPanelVisible: isResultPanelVisibleRef.current,
    }, useStore.getState().tabs);
  }, [activeResultKeyRef, isResultPanelVisibleRef, resultSetsRef, tabId]);
};
