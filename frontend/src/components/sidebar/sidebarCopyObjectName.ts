import { t } from '../../i18n';

export const resolveCopyObjectNameLabel = (node: { type?: string } | null | undefined): string => {
  if (node?.type === 'view') return t('sidebar.copy_object_name.label.view');
  if (node?.type === 'materialized-view') return t('sidebar.copy_object_name.label.materialized_view');
  if (node?.type === 'sequence') return t('sidebar.copy_object_name.label.sequence');
  if (node?.type === 'package') return t('sidebar.copy_object_name.label.package');
  if (node?.type === 'db-event') return t('sidebar.copy_object_name.label.event');
  if (node?.type === 'database-link') return t('sidebar.copy_object_name.label.database_link');
  return t('sidebar.copy_object_name.label.table');
};
