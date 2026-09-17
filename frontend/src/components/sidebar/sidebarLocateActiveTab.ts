import {
  normalizeSidebarLocateObjectRequestFromTab,
  type SidebarLocateObjectRequest,
  type SidebarLocateTabLike,
} from '../../utils/sidebarLocate';

export const SIDEBAR_LOCATE_ACTIVE_QUERY_TABLE_EVENT = 'gonavi:locate-active-query-table';

export type SidebarActiveTabLocateAction =
  | { kind: 'object'; request: SidebarLocateObjectRequest }
  | { kind: 'query-line-table' }
  | { kind: 'unavailable' };

const toTrimmedString = (value: unknown): string => String(value ?? '').trim();

export const resolveSidebarActiveTabLocateAction = ({
  tab,
  hasConnection,
}: {
  tab: SidebarLocateTabLike | null | undefined;
  hasConnection: boolean;
}): SidebarActiveTabLocateAction => {
  const request = normalizeSidebarLocateObjectRequestFromTab(tab);
  if (request) {
    return { kind: 'object', request };
  }

  const isUnsavedQueryTab = tab?.type === 'query' && !toTrimmedString(tab.filePath);
  if (isUnsavedQueryTab && hasConnection && toTrimmedString(tab.dbName)) {
    return { kind: 'query-line-table' };
  }

  return { kind: 'unavailable' };
};

export const canLocateSidebarActiveTab = (
  action: SidebarActiveTabLocateAction,
): boolean => action.kind !== 'unavailable';

/** Short, user-safe description of an unexpected locate failure (never a stack trace). */
export const describeSidebarLocateFailure = (error: unknown): string => {
  const raw = error instanceof Error
    ? `${error.name}: ${error.message}`
    : toTrimmedString(typeof error === 'string' ? error : (error as { message?: unknown })?.message);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return 'unknown';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};
