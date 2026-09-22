export const shouldDestroyHiddenQueryResult = (
  result: { key?: string; hasPendingChanges?: boolean },
): boolean => result.hasPendingChanges !== true;

export const resolveMountedQueryResultKey = (
  resultSets: Array<{ key: string; hasPendingChanges?: boolean }>,
  activeKey: string,
  panelHidden: boolean,
): string => (
  panelHidden
    ? resultSets.find((result) => result.hasPendingChanges === true)?.key || activeKey
    : activeKey
);
