import { t } from '../../i18n';
import type { TabData } from '../../types';

const resolveNodeSchemaName = (node: { dataRef?: { schemaName?: unknown } } | null | undefined): string | undefined => {
  const schemaName = String(node?.dataRef?.schemaName ?? '').trim();
  return schemaName || undefined;
};

const resolveDatabaseLinkName = (node: {
  title?: unknown;
  dataRef?: { databaseLinkName?: unknown };
} | null | undefined): string => {
  const fromData = String(node?.dataRef?.databaseLinkName ?? '').trim();
  if (fromData) return fromData;
  return typeof node?.title === 'string' ? node.title.trim() : '';
};

type AddTab = (tab: TabData) => void;

export const openDatabaseLinkDefinition = (
  node: {
    key?: unknown;
    title?: unknown;
    dataRef?: {
      databaseLinkName?: unknown;
      dbName?: unknown;
      id?: unknown;
      schemaName?: unknown;
    };
  },
  addTab: AddTab,
): void => {
  const databaseLinkName = resolveDatabaseLinkName(node);
  const dbName = String(node?.dataRef?.dbName || '').trim();
  const id = String(node?.dataRef?.id || '').trim();
  if (!databaseLinkName || !id) return;
  const schemaName = resolveNodeSchemaName(node);
  addTab({
    id: `database-link-def-${id}-${dbName}${schemaName ? `-${schemaName}` : ''}-${databaseLinkName}`,
    title: t('sidebar.tab.database_link_definition', { name: databaseLinkName }),
    type: 'database-link-def',
    connectionId: id,
    dbName,
    databaseLinkName,
    schemaName,
    sidebarLocateKey: String(node.key || ''),
  });
};
