import { useRef } from 'react';

/**
 * Latches to `true` the first time a query editor becomes the active tab.
 *
 * Metadata, schema and database-list loading are gated on this instead of the live
 * `isActive` flag: an editor that was never shown must not hit the database, but one
 * that was already used keeps its in-flight requests when the user switches away and
 * does not refetch everything when they come back. Shared (active-editor) state is
 * still written only while the editor is actually active.
 */
export const useQueryEditorEverActive = (isActive: boolean): boolean => {
  const everActiveRef = useRef(isActive);
  if (isActive) everActiveRef.current = true;
  return everActiveRef.current;
};
