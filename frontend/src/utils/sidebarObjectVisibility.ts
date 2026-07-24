export const SIDEBAR_OBJECT_GROUP_KEYS = [
  'savedQueries',
  'tables',
  'views',
  'materializedViews',
  'sequences',
  'routines',
  'packages',
  'triggers',
  'events',
] as const;

export type SidebarObjectGroupKey = (typeof SIDEBAR_OBJECT_GROUP_KEYS)[number];

type SidebarObjectVisibilityTreeNode = {
  type?: string;
  dataRef?: { groupKey?: unknown };
  children?: SidebarObjectVisibilityTreeNode[];
  isLeaf?: boolean;
};

const SIDEBAR_OBJECT_GROUP_KEY_SET = new Set<string>(SIDEBAR_OBJECT_GROUP_KEYS);

export const sanitizeSidebarHiddenObjectGroups = (value: unknown): SidebarObjectGroupKey[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SidebarObjectGroupKey>();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const key = item.trim();
    if (SIDEBAR_OBJECT_GROUP_KEY_SET.has(key)) {
      seen.add(key as SidebarObjectGroupKey);
    }
  });
  return Array.from(seen);
};

const resolveObjectGroupKey = (
  node: SidebarObjectVisibilityTreeNode,
): SidebarObjectGroupKey | null => {
  if (node.type === 'queries-folder' || node.type === 'all-saved-queries') {
    return 'savedQueries';
  }
  if (node.type !== 'object-group') return null;
  const groupKey = String(node.dataRef?.groupKey || '').trim();
  return SIDEBAR_OBJECT_GROUP_KEY_SET.has(groupKey)
    ? groupKey as SidebarObjectGroupKey
    : null;
};

const isSchemaGroupNode = (node: SidebarObjectVisibilityTreeNode): boolean => (
  node.type === 'object-group' && node.dataRef?.groupKey === 'schema'
);

export const filterSidebarTreeByHiddenObjectGroups = <T extends SidebarObjectVisibilityTreeNode>(
  nodes: T[],
  hiddenObjectGroups: readonly SidebarObjectGroupKey[],
): T[] => {
  if (hiddenObjectGroups.length === 0) return nodes;
  const hidden = new Set(hiddenObjectGroups);

  return nodes.flatMap((node): T[] => {
    const objectGroupKey = resolveObjectGroupKey(node);
    if (objectGroupKey && hidden.has(objectGroupKey)) return [];

    if (!node.children || node.children.length === 0) return [node];
    const originalChildren = node.children;
    const children = filterSidebarTreeByHiddenObjectGroups(originalChildren as T[], hiddenObjectGroups);
    if (isSchemaGroupNode(node) && children.length === 0) return [];
    const childrenUnchanged = children.length === originalChildren.length
      && children.every((child, index) => child === originalChildren[index]);
    if (childrenUnchanged) return [node];

    return [{
      ...node,
      children,
      ...(children.length === 0 ? { isLeaf: true } : {}),
    }];
  });
};
