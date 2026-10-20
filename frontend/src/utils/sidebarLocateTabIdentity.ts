import type { SidebarLocateDatabaseObjectGroup, SidebarLocateTabLike } from './sidebarLocate';

const toTrimmedString = (value: unknown): string => String(value ?? '').trim();

export const inferObjectGroup = (detail: Record<string, unknown>, connectionId: string, dbName: string): SidebarLocateDatabaseObjectGroup => {
  const explicitGroup = toTrimmedString(detail.objectGroup);
  if (explicitGroup === 'views' || explicitGroup === 'view') return 'views';
  if (explicitGroup === 'materializedViews' || explicitGroup === 'materialized-view') return 'materializedViews';
  if (explicitGroup === 'triggers' || explicitGroup === 'trigger') return 'triggers';
  if (explicitGroup === 'routines' || explicitGroup === 'routine') return 'routines';
  if (explicitGroup === 'sequences' || explicitGroup === 'sequence') return 'sequences';
  if (explicitGroup === 'packages' || explicitGroup === 'package') return 'packages';
  if (explicitGroup === 'events' || explicitGroup === 'event') return 'events';
  if (explicitGroup === 'jobs' || explicitGroup === 'job') return 'jobs';
  if (explicitGroup === 'databaseLinks' || explicitGroup === 'database-link' || explicitGroup === 'database_link') return 'databaseLinks';

  const explicitType = toTrimmedString(detail.objectType);
  if (explicitType === 'view' || explicitType === 'views') return 'views';
  if (explicitType === 'materialized' || explicitType === 'materialized-view') return 'materializedViews';
  if (explicitType === 'trigger' || explicitType === 'triggers') return 'triggers';
  if (explicitType === 'routine' || explicitType === 'routines') return 'routines';
  if (explicitType === 'sequence' || explicitType === 'sequences') return 'sequences';
  if (explicitType === 'package' || explicitType === 'packages') return 'packages';
  if (explicitType === 'event' || explicitType === 'events') return 'events';
  if (explicitType === 'job' || explicitType === 'jobs' || explicitType === 'db-job') return 'jobs';
  if (explicitType === 'database-link' || explicitType === 'database_link' || explicitType === 'databaseLinks') return 'databaseLinks';

  const tabId = toTrimmedString(detail.tabId);
  const dbNodeKey = `${connectionId}-${dbName}`;
  if (tabId.startsWith(`${dbNodeKey}-materialized-view-`)) return 'materializedViews';
  if (tabId.startsWith(`${dbNodeKey}-view-`)) return 'views';
  if (tabId.startsWith(`${dbNodeKey}-trigger-`)) return 'triggers';
  if (tabId.startsWith(`${dbNodeKey}-routine-`) || tabId.startsWith(`routine-def-${connectionId}-${dbName}-`)) return 'routines';
  if (tabId.startsWith(`${dbNodeKey}-sequence-`) || tabId.startsWith(`sequence-def-${connectionId}-${dbName}-`)) return 'sequences';
  if (tabId.startsWith(`${dbNodeKey}-package-`) || tabId.startsWith(`package-def-${connectionId}-${dbName}-`)) return 'packages';
  if (tabId.startsWith(`${dbNodeKey}-event-`) || tabId.startsWith(`event-def-${connectionId}-${dbName}-`)) return 'events';
  if (tabId.includes('-databaseLinks-') || tabId.startsWith(`database-link-def-${connectionId}-`)) return 'databaseLinks';

  return 'tables';
};

export const resolveObjectEditLocateIdentity = (
  tab: SidebarLocateTabLike,
): { objectName: string; objectGroup: SidebarLocateDatabaseObjectGroup } | null => {
  const jobName = toTrimmedString(tab.jobName);
  if (jobName) return { objectName: jobName, objectGroup: 'jobs' };
  const routineName = toTrimmedString(tab.routineName);
  if (routineName) {
    return { objectName: routineName, objectGroup: 'routines' };
  }
  const triggerName = toTrimmedString(tab.triggerName);
  if (triggerName) {
    return { objectName: triggerName, objectGroup: 'triggers' };
  }
  const sequenceName = toTrimmedString(tab.sequenceName);
  if (sequenceName) {
    return { objectName: sequenceName, objectGroup: 'sequences' };
  }
  const packageName = toTrimmedString(tab.packageName);
  if (packageName) {
    return { objectName: packageName, objectGroup: 'packages' };
  }
  const databaseLinkName = toTrimmedString(tab.databaseLinkName);
  if (databaseLinkName) {
    return { objectName: databaseLinkName, objectGroup: 'databaseLinks' };
  }
  const eventName = toTrimmedString(tab.eventName);
  if (eventName) {
    return { objectName: eventName, objectGroup: 'events' };
  }
  const viewName = toTrimmedString(tab.viewName);
  if (viewName) {
    const isMaterialized = tab.viewKind === 'materialized' || tab.objectType === 'materialized-view';
    return { objectName: viewName, objectGroup: isMaterialized ? 'materializedViews' : 'views' };
  }
  return null;
};

export const resolveDefinitionTabObjectGroup = (tab: SidebarLocateTabLike): SidebarLocateDatabaseObjectGroup | undefined => {
  if (tab.type === 'job-def') return 'jobs';
  if (tab.type === 'view-def') return tab.viewKind === 'materialized' ? 'materializedViews' : 'views';
  if (tab.type === 'trigger') return 'triggers';
  if (tab.type === 'routine-def') return 'routines';
  if (tab.type === 'sequence-def') return 'sequences';
  if (tab.type === 'package-def') return 'packages';
  if (tab.type === 'database-link-def') return 'databaseLinks';
  if (tab.type === 'event-def') return 'events';
  if (tab.objectType === 'materialized-view') return 'materializedViews';
  if (tab.objectType === 'view') return 'views';
  return undefined;
};
