import type { MenuProps } from 'antd';
import type { SavedConnection } from '../../types';
import { t } from '../../i18n';
import { resolveDatabaseJobDialect, usesSchemaScopedDatabaseJobs } from '../../utils/databaseJobs/jobCapabilities';
import { createJobSources } from '../../utils/databaseJobs/jobManagementPlans';
import { isDatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { isJobMutationRestricted } from '../databaseJobs/jobManagementExecution';
import type { JobManagementRequest } from '../databaseJobs/jobManagementRequest';
import type { SidebarTreeNode } from './sidebarV2TreeNodes';

export const buildJobManagementMenuItems = (node: SidebarTreeNode): NonNullable<MenuProps['items']> => {
  const data = node.dataRef;
  if (!data?.id || !data.config) return [];
  const connection = data as SavedConnection;
  const dialect = resolveDatabaseJobDialect(connection.config);
  if (!dialect) return [];
  const base = { connectionId: connection.id, database: String(data.dbName || ''), owner: String(data.schemaName || (usesSchemaScopedDatabaseJobs(connection.config) ? data.dbName : '') || '') };
  const open = (request: JobManagementRequest) => { void import('../databaseJobs/openJobManagement').then(m => m.openJobManagement(request)); };
  if (node.type === 'db-job' && isDatabaseJobKind(data.jobKind)) {
    const kind = data.jobKind;
    return [{ key: 'manage-job', label: t('database_jobs.manage.title'), onClick: () => open({ ...base, name: String(data.jobName || ''), kind, operation: 'status' }) }];
  }
  return createJobSources({ dialect, database: base.database }).map(kind => ({
    key: `create-job-${kind}`, label: t('database_jobs.manage.create_source', { source: t(`database_jobs.source.${kind}`) }),
    disabled: isJobMutationRestricted(connection),
    onClick: () => open({ ...base, name: '', kind, operation: 'create' }),
  }));
};
