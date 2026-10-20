import type { SavedConnection } from '../../types';
import { resolveJobManagementDialect } from '../../utils/databaseJobs/jobManagementTypes';

type EventNode = { dataRef?: Partial<SavedConnection> & { dbName?: string; eventName?: string } };

export const supportsEventManagement = (node: EventNode): boolean => {
  const dialect = resolveJobManagementDialect(node.dataRef?.config);
  return dialect === 'mysql' || dialect === 'mariadb';
};

export const openEventManagement = (node: EventNode, create = false): void => {
  const data = node.dataRef;
  if (!data?.id || !supportsEventManagement(node)) return;
  void import('../databaseJobs/openJobManagement').then(m => m.openJobManagement({
    connectionId: data.id!, database: String(data.dbName || ''), owner: '',
    name: create ? '' : String(data.eventName || ''), kind: 'mysql-event', operation: create ? 'create' : 'status',
  }));
};
