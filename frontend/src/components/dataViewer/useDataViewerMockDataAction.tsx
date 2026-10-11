import React, { useMemo } from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as defaultTranslate } from '../../i18n';
import { useStore } from '../../store';
import type { TabData } from '../../types';
import { buildMockDataWorkbenchTab, canGenerateMockData } from '../../utils/mockDataTab';
import { DataViewerMockDataButton } from './DataViewerMockDataButton';

/**
 * 表数据页工具栏的"生成模拟数据"按钮；数据源不支持、连接受限或不是表时返回 null，不占工具栏位置。
 */
export const useDataViewerMockDataAction = (tab: TabData): React.ReactNode => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  const connection = useStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const addTab = useStore((state) => state.addTab);
  const enabled = Boolean(tab.tableName)
    && (!tab.objectType || tab.objectType === 'table')
    && canGenerateMockData(connection);
  return useMemo(() => {
    if (!enabled) return null;
    return (
      <DataViewerMockDataButton
        label={t('data_grid.toolbar.mock_data')}
        onClick={() => addTab(buildMockDataWorkbenchTab({
          connectionId: tab.connectionId,
          dbName: tab.dbName,
          tableName: String(tab.tableName || ''),
          schemaName: tab.schemaName,
        }))}
      />
    );
  }, [addTab, enabled, t, tab.connectionId, tab.dbName, tab.schemaName, tab.tableName]);
};
