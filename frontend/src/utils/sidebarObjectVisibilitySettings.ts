import type { SidebarObjectGroupKey } from './sidebarObjectVisibility';

export type SidebarObjectVisibilitySetting = {
  key: SidebarObjectGroupKey;
  label: string;
};

export const buildSidebarObjectVisibilitySettings = (
  translate: (key: string) => string,
): SidebarObjectVisibilitySetting[] => [
  { key: 'savedQueries', label: translate('sidebar.tree.saved_queries') },
  { key: 'tables', label: translate('sidebar.object_group.tables') },
  { key: 'views', label: translate('sidebar.object_group.views') },
  { key: 'materializedViews', label: translate('sidebar.object_group.materialized_views') },
  { key: 'routines', label: translate('sidebar.object_group.routines') },
  { key: 'triggers', label: translate('sidebar.object_group.triggers') },
  { key: 'events', label: translate('sidebar.object_group.events') },
  { key: 'sequences', label: translate('sidebar.object_group.sequences') },
  { key: 'packages', label: translate('sidebar.object_group.packages') },
  { key: 'databaseLinks', label: translate('sidebar.object_group.database_links') },
];
