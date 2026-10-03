import type { SavedConnection } from '../../types';
import { getDataSourceSpec } from '../../utils/dataSourceRegistry';
import type { SidebarTreeNode } from './sidebarV2TreeNodes';

/**
 * 去掉描述表声明为不支持的对象分组（如 TiDB 没有存储过程、触发器与事件），
 * 避免借用 MySQL / PostgreSQL 方言的数据源在侧栏出现永远为空的分组。
 */
export const filterRegistryObjectGroups = (
  conn: SavedConnection | undefined,
  groups: SidebarTreeNode[],
): SidebarTreeNode[] => {
  const hidden = getDataSourceSpec(conn?.config?.type)?.ui?.hiddenObjectGroups;
  if (!hidden || hidden.length === 0) return groups;
  return groups.filter((group) => !hidden.includes(String(group.dataRef?.groupKey ?? '')));
};
