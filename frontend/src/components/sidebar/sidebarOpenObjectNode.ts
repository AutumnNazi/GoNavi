import type { TabData } from '../../types';
import { openDatabaseLinkDefinition } from './sidebarOpenDatabaseLinkDefinition';

type SidebarObjectNode = {
  key?: unknown;
  type?: string;
  dataRef?: Record<string, any>;
};

type OpenSidebarObjectNodeDeps = {
  addTab: (tab: TabData) => void;
  openEventDefinition: (node: SidebarObjectNode) => void;
  openSequenceDefinition: (node: SidebarObjectNode) => void;
  openPackageDefinition: (node: SidebarObjectNode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  buildOptionalSchemaContext: (value: unknown) => { schemaName?: string };
};

export const tryOpenSidebarObjectNode = (
  node: SidebarObjectNode,
  deps: OpenSidebarObjectNodeDeps,
): boolean => {
  const { addTab, openEventDefinition, openSequenceDefinition, openPackageDefinition, t, buildOptionalSchemaContext } = deps;
  if (node.type === 'view' || node.type === 'materialized-view') {
    const { viewName, dbName, id, schemaName } = node.dataRef || {};
    addTab({
      id: String(node.key || ''),
      title: viewName,
      type: 'table',
      connectionId: id,
      dbName,
      tableName: viewName,
      objectType: node.type === 'materialized-view' ? 'materialized-view' : 'view',
      schemaName,
      sidebarLocateKey: String(node.key || ''),
    });
    return true;
  }
  if (node.type === 'db-trigger') {
    const { triggerName, triggerTableName, schemaName, dbName, id } = node.dataRef || {};
    addTab({
      id: `trigger-${node.key}`,
      title: t('sidebar.tab.trigger', { name: triggerName }),
      type: 'trigger',
      connectionId: id,
      dbName,
      triggerName,
      triggerTableName,
      schemaName,
      sidebarLocateKey: String(node.key || ''),
    });
    return true;
  }
  if (node.type === 'db-event') {
    openEventDefinition(node);
    return true;
  }
  if (node.type === 'routine') {
    const { routineName, routineType, dbName, id, schemaName } = node.dataRef || {};
    const typeLabel = t(routineType === 'PROCEDURE' ? 'sidebar.object.procedure' : 'sidebar.object.function');
    addTab({
      id: `routine-def-${node.key}`,
      title: t('sidebar.tab.routine_definition', { type: typeLabel, name: routineName }),
      type: 'routine-def',
      connectionId: id,
      dbName,
      routineName,
      routineType,
      ...buildOptionalSchemaContext(schemaName),
    });
    return true;
  }
  if (node.type === 'sequence') {
    openSequenceDefinition(node);
    return true;
  }
  if (node.type === 'package') {
    openPackageDefinition(node);
    return true;
  }
  if (node.type === 'database-link') {
    openDatabaseLinkDefinition(node, addTab);
    return true;
  }
  return false;
};
