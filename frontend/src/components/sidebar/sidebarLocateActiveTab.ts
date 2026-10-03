import {
  normalizeSidebarLocateObjectRequestFromTab,
  type SidebarLocateObjectRequest,
  type SidebarLocateTabLike,
} from '../../utils/sidebarLocate';

export const SIDEBAR_LOCATE_ACTIVE_QUERY_TABLE_EVENT = 'gonavi:locate-active-query-table';

export type SidebarActiveTabLocateAction =
  | { kind: 'object'; request: SidebarLocateObjectRequest }
  | { kind: 'query-line-table'; fallbackRequest?: SidebarLocateObjectRequest }
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
  const isQueryTab = tab?.type === 'query' && !toTrimmedString(tab.filePath);
  if (isQueryTab && hasConnection && (
    request?.objectGroup === 'savedQueries' || (!request && toTrimmedString(tab.dbName))
  )) {
    return {
      kind: 'query-line-table',
      ...(request?.objectGroup === 'savedQueries' ? { fallbackRequest: request } : {}),
    };
  }

  if (request) {
    return { kind: 'object', request };
  }

  return { kind: 'unavailable' };
};

export const canLocateSidebarActiveTab = (
  action: SidebarActiveTabLocateAction,
): boolean => action.kind !== 'unavailable';

export const dispatchSidebarActiveQueryTableLocate = (
  action: Extract<SidebarActiveTabLocateAction, { kind: 'query-line-table' }>,
): void => {
  window.dispatchEvent(new CustomEvent(SIDEBAR_LOCATE_ACTIVE_QUERY_TABLE_EVENT, {
    detail: action.fallbackRequest,
  }));
};

/** Short, user-safe description of an unexpected locate failure (never a stack trace). */
export const describeSidebarLocateFailure = (error: unknown): string => {
  const raw = error instanceof Error
    ? `${error.name}: ${error.message}`
    : toTrimmedString(typeof error === 'string' ? error : (error as { message?: unknown })?.message);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return 'unknown';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};
