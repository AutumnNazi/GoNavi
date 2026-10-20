import React from 'react';
import { Button } from 'antd';
import { t } from '../../i18n';
import type { TabData } from '../../types';
import { useStore } from '../../store';
import { resolveJobManagementDialect } from '../../utils/databaseJobs/jobManagementTypes';

export const JobManagementButton = ({ tab, onChanged }: { tab: TabData; onChanged?: () => void | Promise<unknown> }) => {
  const connection = useStore(s => s.connections.find(c => c.id === tab.connectionId));
  const dialect = resolveJobManagementDialect(connection?.config);
  const event = tab.type === 'event-def' && (dialect === 'mysql' || dialect === 'mariadb');
  const kind = event ? 'mysql-event' : tab.jobKind;
  if (!kind) return null;
  return <Button size="small" disabled={!tab.jobName && !tab.eventName} onClick={() => {
    if (!tab.connectionId) return;
    void import('./openJobManagement').then(({ openJobManagement }) => openJobManagement({
      connectionId: tab.connectionId!, database: tab.dbName || '', owner: tab.schemaName || '',
      name: (event ? tab.eventName : tab.jobName) || '', kind, operation: 'status', onChanged,
    }));
  }}>{t('database_jobs.manage.title')}</Button>;
};
