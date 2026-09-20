export type SidebarTableSortPreference = 'name' | 'frequency' | 'manual';
export type SidebarTreeOrders = Record<string, string[]>;
export type SidebarTreeOrderUpdates = Record<string, readonly string[] | null>;

const MAX_SIDEBAR_TREE_ORDER_PARENTS = 1024;
const MAX_SIDEBAR_TREE_ORDER_CHILDREN = 10_000;
const MAX_SIDEBAR_TREE_ORDER_KEY_LENGTH = 2048;

const toOrderKey = (value: unknown): string => (
  typeof value === 'string' ? value.trim().slice(0, MAX_SIDEBAR_TREE_ORDER_KEY_LENGTH) : ''
);

const sanitizeSidebarTreeOrder = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const key = toOrderKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= MAX_SIDEBAR_TREE_ORDER_CHILDREN) break;
  }
  return result;
};

export const sanitizeSidebarTreeOrders = (value: unknown): SidebarTreeOrders => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: SidebarTreeOrders = {};
  for (const [rawParentKey, rawOrder] of Object.entries(value)) {
    const parentKey = toOrderKey(rawParentKey);
    const order = sanitizeSidebarTreeOrder(rawOrder);
    if (!parentKey || order.length === 0) continue;
    result[parentKey] = order;
    if (Object.keys(result).length >= MAX_SIDEBAR_TREE_ORDER_PARENTS) break;
  }
  return result;
};

export const updateSidebarTreeOrders = (
  current: unknown,
  updates: SidebarTreeOrderUpdates,
): SidebarTreeOrders => {
  const next = { ...sanitizeSidebarTreeOrders(current) };
  Object.entries(updates).forEach(([rawParentKey, rawOrder]) => {
    const parentKey = toOrderKey(rawParentKey);
    if (!parentKey) return;
    const order = sanitizeSidebarTreeOrder(rawOrder);
    if (order.length === 0) {
      delete next[parentKey];
    } else {
      next[parentKey] = order;
    }
  });
  return sanitizeSidebarTreeOrders(next);
};

export const buildSidebarTablePinKey = (
  connectionId: string,
  dbName: string,
  tableName: string,
  schemaName = '',
): string => {
  const parts = [connectionId, dbName, schemaName, tableName].map((part) => String(part || '').trim());
  return parts[0] && parts[1] && parts[3] ? JSON.stringify(parts) : '';
};

export const buildSidebarDatabasePinKey = (
  connectionId: string,
  dbName: string,
): string => {
  const parts = [connectionId, dbName].map((part) => String(part || '').trim());
  return parts[0] && parts[1] ? JSON.stringify(parts) : '';
};

export const updateSidebarDatabasePinKeys = (
  pinnedKeys: unknown,
  connectionId: string,
  dbName: string,
  pinned: boolean,
): string[] => {
  const current = new Set(
    (Array.isArray(pinnedKeys) ? pinnedKeys : [])
      .map((value) => toOrderKey(value))
      .filter(Boolean),
  );
  const key = buildSidebarDatabasePinKey(connectionId, dbName);
  if (!key) return Array.from(current);
  if (pinned) current.add(key);
  else current.delete(key);
  return Array.from(current);
};
