import type { TabData } from '../types';

export const selectWorkbenchTabs = <TState extends { tabs: TabData[] }>(state: TState): TabData[] => (
  state.tabs
);

const QUERY_FIELD = 'query';
const hasOwn = (value: object, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const areTabMetadataFieldsEqual = (left: TabData, right: TabData): boolean => {
  if (Object.is(left, right)) return true;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const leftMetadataKeyCount = leftKeys.length - (hasOwn(left, QUERY_FIELD) ? 1 : 0);
  const rightMetadataKeyCount = rightKeys.length - (hasOwn(right, QUERY_FIELD) ? 1 : 0);
  if (leftMetadataKeyCount !== rightMetadataKeyCount) return false;

  for (const key of leftKeys) {
    if (key === QUERY_FIELD) continue;
    if (!hasOwn(right, key) || !Object.is(left[key as keyof TabData], right[key as keyof TabData])) {
      return false;
    }
  }
  return true;
};

/**
 * Workbench chrome needs tab identity, order, and metadata, but not editor text.
 * Compare every current own field except `query` so future TabData fields opt in
 * automatically instead of being silently omitted from the render boundary.
 */
export const areWorkbenchTabsEqualIgnoringQuery = (
  left: TabData[],
  right: TabData[],
): boolean => {
  if (Object.is(left, right)) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (!areTabMetadataFieldsEqual(left[index], right[index])) return false;
  }
  return true;
};

/** Creates a per-subscriber selector whose result stays referentially stable for query-only updates. */
export const createWorkbenchTabsSelector = () => {
  let previousTabs: TabData[] | undefined;
  return <TState extends { tabs: TabData[] }>(state: TState): TabData[] => {
    if (
      previousTabs
      && areWorkbenchTabsEqualIgnoringQuery(previousTabs, state.tabs)
    ) {
      return previousTabs;
    }
    previousTabs = state.tabs;
    return state.tabs;
  };
};
