import { useCallback, type MutableRefObject } from 'react';
import { message } from 'antd';
import { t } from '../../i18n';
import type { SavedConnection, TabData } from '../../types';
import { buildMockDataWorkbenchTab, canGenerateMockData, type MockDataWorkbenchTarget } from '../../utils/mockDataTab';

type SidebarNodeLike = {
  type?: string;
  title?: unknown;
  dataRef?: { id?: string; dbName?: string; tableName?: string; schemaName?: string };
};

type LauncherInput = {
  selectedNodesRef: MutableRefObject<SidebarNodeLike[]>;
  tabs: TabData[];
  activeTabId: string | null;
  connections: SavedConnection[];
  addTab: (tab: TabData) => void;
};

/** 选中的表节点优先，其次是当前打开的表数据页。 */
export const resolveMockDataLaunchTarget = (
  node: SidebarNodeLike | undefined,
  activeTab: TabData | undefined,
): MockDataWorkbenchTarget | null => {
  if (node?.type === 'table') {
    const tableName = String(node.dataRef?.tableName || node.title || '').trim();
    const connectionId = String(node.dataRef?.id || '').trim();
    return tableName && connectionId
      ? { connectionId, dbName: node.dataRef?.dbName, tableName, schemaName: node.dataRef?.schemaName }
      : null;
  }
  if (activeTab?.type === 'table' && activeTab.tableName) {
    return {
      connectionId: activeTab.connectionId,
      dbName: activeTab.dbName,
      tableName: activeTab.tableName,
      schemaName: activeTab.schemaName,
    };
  }
  return null;
};

/** 标题栏「数据工作流 → 生成模拟数据」：需要先选中一张表或打开表数据页。 */
export const useSidebarMockDataLauncher = ({ selectedNodesRef, tabs, activeTabId, connections, addTab }: LauncherInput) => (
  useCallback(() => {
    const target = resolveMockDataLaunchTarget(selectedNodesRef.current[0], tabs.find((tab) => tab.id === activeTabId));
    if (!target) {
      void message.info(t('mock_data.entry.select_table_first'));
      return;
    }
    const connection = connections.find((item) => item.id === target.connectionId);
    if (!canGenerateMockData(connection)) {
      void message.warning(t('mock_data.entry.unsupported'));
      return;
    }
    addTab(buildMockDataWorkbenchTab(target));
  }, [activeTabId, addTab, connections, selectedNodesRef, tabs])
);
