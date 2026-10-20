import type { MenuProps } from 'antd';
import { CodeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SavedConnection, TabData } from '../../types';
import type { DatabaseJobEntry, DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import { t } from '../../i18n';
import type { SidebarTreeNode } from './sidebarV2TreeNodes';
import type { SidebarNodeMenuContext } from './sidebarNodeMenuHelpers';
import { renderSidebarObjectIcon } from './sidebarObjectIcons';
import { createSidebarObjectGroupBuilder } from './sidebarObjectGroup';
import { buildSidebarCopyObjectNameMenuItem } from './sidebarCopyObjectNameMenu';
import { buildJobManagementMenuItems } from './sidebarJobManagementMenu';

type JobNode = {
  key?: unknown;
  dataRef?: {
    id?: string;
    dbName?: string;
    schemaName?: string;
    jobName?: string;
    jobLabel?: string;
    jobKind?: DatabaseJobKind;
  };
};

const databaseJobTitle = (entry: DatabaseJobEntry): string => {
  if (entry.jobKind === 'pg-cron' || entry.jobKind === 'pgagent') {
    const label = entry.jobLabel ? `${entry.jobLabel} · ${entry.jobName}` : entry.jobName;
    return `${label} · ${t(`database_jobs.source.${entry.jobKind}`)}`;
  }
  if (entry.jobKind === 'dbms-job') return `${entry.jobName} · DBMS_JOB`;
  return entry.jobLabel || entry.jobName;
};

export const buildDatabaseJobGroup = (
  conn: SavedConnection & { dbName?: string },
  parentKey: string,
  entries: DatabaseJobEntry[],
  schemaName = '',
): SidebarTreeNode => {
  const children: SidebarTreeNode[] = entries.filter((entry) => !schemaName || entry.schemaName === schemaName).map((entry) => ({
    title: databaseJobTitle(entry),
    key: `${parentKey}-job-${encodeURIComponent(JSON.stringify([entry.jobKind, entry.schemaName, entry.jobName]))}`,
    icon: renderSidebarObjectIcon('job'),
    type: 'db-job',
    isLeaf: true,
    dataRef: { ...conn, ...entry },
  }));
  return createSidebarObjectGroupBuilder(conn)(
    parentKey, 'jobs', t('sidebar.object_group.jobs'), renderSidebarObjectIcon('job'), children, { schemaName },
  );
};

export const openDatabaseJobDefinition = (node: JobNode, addTab: (tab: TabData) => void): void => {
  const { id, dbName, schemaName, jobName, jobLabel, jobKind } = node.dataRef || {};
  if (!id || !jobName || !jobKind) return;
  const name = jobKind === 'pg-cron' || jobKind === 'pgagent'
    ? `${jobLabel || jobName} · ${t(`database_jobs.source.${jobKind}`)}` : jobLabel || jobName;
  addTab({
    id: `job-def-${encodeURIComponent(JSON.stringify([id, dbName || '', schemaName || '', jobKind, jobName]))}`,
    title: t('sidebar.tab.job_definition', { name }),
    type: 'job-def',
    connectionId: id,
    dbName,
    schemaName,
    jobName,
    ...(jobLabel ? { jobLabel } : {}),
    jobKind,
    sidebarLocateKey: String(node.key || ''),
  });
};

export const buildDatabaseJobMenuItems = (
  node: SidebarTreeNode,
  context: SidebarNodeMenuContext,
): MenuProps['items'] => {
  if (node.type === 'db-job') {
    return [{
      key: 'view-job-def', label: t('sidebar.menu.view_job_definition'), icon: <CodeOutlined />,
      onClick: () => openDatabaseJobDefinition(node, context.addTab),
    }, ...buildJobManagementMenuItems(node), buildSidebarCopyObjectNameMenuItem(node, context.handleCopyTableName, 'copy-job-name')];
  }
  return [...buildJobManagementMenuItems(node), {
    key: 'refresh-jobs', label: t('common.refresh'), icon: <ReloadOutlined />,
    onClick: () => { void context.loadTables(context.getDatabaseNodeRef(node.dataRef, String(node.dataRef?.dbName || '')), { ensureFresh: true }); },
  }];
};
