import { t } from '../i18n';
import type { SavedConnection, TabData } from '../types';
import { getDataSourceCapabilities } from './dataSourceCapabilities';

export type MockDataWorkbenchTarget = {
  connectionId: string;
  dbName?: string;
  tableName: string;
  schemaName?: string;
};

const normalize = (value: string | undefined): string => String(value || '').trim();

/** 每张表一个模拟数据标签页，重复打开同一张表会切回已有标签页。 */
export const buildMockDataWorkbenchTabId = (target: MockDataWorkbenchTarget): string => (
  ['mock-data', normalize(target.connectionId), normalize(target.dbName), normalize(target.tableName)]
    .map((part) => encodeURIComponent(part))
    .join(':')
);

export const buildMockDataWorkbenchTab = (target: MockDataWorkbenchTarget): TabData => {
  const tableName = normalize(target.tableName);
  return {
    id: buildMockDataWorkbenchTabId(target),
    title: t('mock_data.tab.title', { table: tableName }),
    type: 'mock-data',
    connectionId: normalize(target.connectionId),
    dbName: normalize(target.dbName) || undefined,
    tableName,
    schemaName: normalize(target.schemaName) || undefined,
  };
};

/** 数据源能力允许且连接没有禁止编辑/导入数据时才显示"生成模拟数据"入口。 */
export const canGenerateMockData = (connection: Pick<SavedConnection, 'config'> | null | undefined): boolean => (
  Boolean(connection?.config) && getDataSourceCapabilities(connection!.config).supportsMockData
);
