import { useEffect, useLayoutEffect, type MutableRefObject } from 'react';

import { useStore } from '../../store';
import {
  saveQueryEditorResultSessionForOpenTab,
  type QueryEditorResultSessionSnapshot,
} from '../../utils/queryEditorResultSessionCache';

type QueryEditorResultSessionRefs = {
  resultSetsRef: MutableRefObject<QueryEditorResultSessionSnapshot['resultSets']>;
  activeResultKeyRef: MutableRefObject<string>;
  isResultPanelVisibleRef: MutableRefObject<boolean>;
  editorRef: MutableRefObject<unknown>;
};

export const readQueryEditorViewState = (
  editor: unknown,
): unknown | undefined => {
  try {
    const saveViewState = (editor as { saveViewState?: unknown } | null)?.saveViewState;
    return typeof saveViewState === 'function' ? saveViewState.call(editor) ?? undefined : undefined;
  } catch {
    return undefined;
  }
};

export const restoreQueryEditorViewState = (
  editor: unknown,
  state: unknown,
): boolean => {
  const restoreViewState = (editor as { restoreViewState?: unknown } | null)?.restoreViewState;
  if (typeof restoreViewState !== 'function' || state === undefined || state === null) return false;
  try {
    restoreViewState.call(editor, state);
    return true;
  } catch {
    return false;
  }
};

export const useQueryEditorResultSessionLifecycle = ({
  tabId,
  resultSets,
  activeResultKey,
  isResultPanelVisible,
  publishesDetachedResultSession,
  resultSetsRef,
  activeResultKeyRef,
  isResultPanelVisibleRef,
  editorRef,
}: QueryEditorResultSessionRefs & {
  tabId: string;
  resultSets: QueryEditorResultSessionSnapshot['resultSets'];
  activeResultKey: string;
  isResultPanelVisible: boolean;
  publishesDetachedResultSession: boolean;
}): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const captureSession = (event: Event) => {
      const requestedTabId = String((event as CustomEvent).detail?.tabId || '').trim();
      if (requestedTabId !== tabId) return;
      saveQueryEditorResultSessionForOpenTab(tabId, {
        resultSets: resultSetsRef.current,
        activeResultKey: activeResultKeyRef.current,
        isResultPanelVisible: isResultPanelVisibleRef.current,
        editorViewState: readQueryEditorViewState(editorRef.current),
      }, useStore.getState().tabs);
    };
    window.addEventListener('gonavi:capture-query-result-session', captureSession);
    return () => window.removeEventListener('gonavi:capture-query-result-session', captureSession);
  }, [activeResultKeyRef, editorRef, isResultPanelVisibleRef, resultSetsRef, tabId]);

  useLayoutEffect(() => () => {
    saveQueryEditorResultSessionForOpenTab(tabId, {
      resultSets: resultSetsRef.current,
      activeResultKey: activeResultKeyRef.current,
      isResultPanelVisible: isResultPanelVisibleRef.current,
      editorViewState: readQueryEditorViewState(editorRef.current),
    }, useStore.getState().tabs);
  }, [activeResultKeyRef, editorRef, isResultPanelVisibleRef, resultSetsRef, tabId]);

  useEffect(() => {
    if (!publishesDetachedResultSession) return;
    saveQueryEditorResultSessionForOpenTab(tabId, {
      resultSets,
      activeResultKey,
      isResultPanelVisible,
      editorViewState: readQueryEditorViewState(editorRef.current),
    }, useStore.getState().tabs);
  }, [activeResultKey, editorRef, isResultPanelVisible, publishesDetachedResultSession, resultSets, tabId]);
};
