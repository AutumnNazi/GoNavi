export const FLUSH_QUERY_EDITOR_RESULT_VIEW_STATE_EVENT = 'gonavi:flush-query-result-view-state';

export const flushQueryEditorResultViewState = (tabId: string | null | undefined): void => {
  const id = String(tabId || '').trim();
  if (!id || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FLUSH_QUERY_EDITOR_RESULT_VIEW_STATE_EVENT, {
    detail: { tabId: id },
  }));
};
